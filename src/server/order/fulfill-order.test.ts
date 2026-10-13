import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, notifyLogs, orders, products } from "@/db/schema";
import { buildMockNotifyBody } from "@/server/payment/mock";
import {
  handlePaymentNotify,
  manualDeliver,
  retryAutoDelivery,
  closeOrder,
  cancelPendingOrder,
  getRejectedNotifyStats,
} from "./fulfill-order";
import { importCards } from "@/server/admin/catalog";
import { createOrder } from "./create-order";
import { lookupOrder, getOrderStatusView } from "./query-order";

/** 服务层全链路验证（PLAN 里程碑 4：mock 支付提前跑通完整链路） */

function seedAutoProduct(cardContents: string[], priceCents = 4250) {
  const slug = `test-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "测试会员卡",
      slug,
      description: "自动发卡测试商品",
      priceCents,
      deliveryType: "auto",
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  for (const content of cardContents) {
    db.insert(cards).values({ productId: p.id, content, status: "available" }).run();
  }
  return { id: p.id, slug };
}

function seedManualProduct(stockLimit = 0) {
  const slug = `test-manual-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "定制服务",
      slug,
      description: "人工发货测试商品",
      priceCents: 9900,
      deliveryType: "manual",
      stockLimit,
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  return { id: p.id, slug };
}

function getOrder(orderNo: string) {
  return db.select().from(orders).where(eq(orders.orderNo, orderNo)).get()!;
}

function paySuccess(orderNo: string, opts?: { amountCents?: bigint; tradeId?: string }) {
  const o = getOrder(orderNo);
  return buildMockNotifyBody({
    orderNo,
    tradeId: opts?.tradeId ?? o.tradeId!,
    amountCents: opts?.amountCents ?? BigInt(o.totalCents),
    status: 2,
  });
}

beforeEach(() => {
  db.run(sql`DELETE FROM orders`);
  db.run(sql`DELETE FROM cards`);
  db.run(sql`DELETE FROM products`);
  db.run(sql`DELETE FROM notify_logs`);
});

describe("mock 全链路：下单 → 支付回调 → 自动发卡", () => {
  it("支付成功回调后自动发卡，卡密状态 sold", async () => {
    const p = seedAutoProduct(["CARD-AAA", "CARD-BBB"]);
    const r = await createOrder({ slug: p.slug, email: "buyer@test.dev", quantity: 1 });
    expect(r.paymentUrl).toContain("/pay/mock?order_no=");
    expect(r.totalCents).toBe(4250n);

    const result = handlePaymentNotify("mock", paySuccess(r.orderNo));
    expect(result.handled).toBe(true);

    const o = getOrder(r.orderNo);
    expect(o.status).toBe("completed");
    expect(o.deliveryContent).toBe("CARD-AAA");
    expect(o.paidAt).not.toBeNull();

    const sold = db.select().from(cards).where(eq(cards.status, "sold")).all();
    expect(sold).toHaveLength(1);
    expect(sold[0].content).toBe("CARD-AAA");
    expect(sold[0].orderId).toBe(r.orderNo);

    // 买家凭订单号+邮箱可取卡密
    const view = lookupOrder(r.orderNo, "buyer@test.dev");
    expect(view?.deliveryContent).toBe("CARD-AAA");
    // 邮箱不符 → 查不到
    expect(lookupOrder(r.orderNo, "other@test.dev")).toBeNull();
  });

  it("数量 >1 时一次发多张", async () => {
    const p = seedAutoProduct(["C1", "C2", "C3"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 2, slug: p.slug });
    handlePaymentNotify("mock", paySuccess(r.orderNo));
    const o = getOrder(r.orderNo);
    expect(o.status).toBe("completed");
    expect(o.deliveryContent?.split("\n")).toHaveLength(2);
    expect(db.select().from(cards).where(eq(cards.status, "sold")).all()).toHaveLength(2);
  });

  it("同一回调重复投递 10 次：只发一张卡（幂等 + 并发安全）", async () => {
    const p = seedAutoProduct(["C1", "C2", "C3", "C4", "C5"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const body = paySuccess(r.orderNo);

    // 模拟并发：事件循环交错触发 10 次同一回调
    await Promise.all(
      Array.from({ length: 10 }, () => new Promise<unknown>((res) => setTimeout(() => res(handlePaymentNotify("mock", body)), 0)))
    );

    const o = getOrder(r.orderNo);
    expect(o.status).toBe("completed");
    expect(db.select().from(cards).where(eq(cards.status, "sold")).all()).toHaveLength(1);
    expect(o.deliveryContent).toBe("C1");
  });

  it("建单后卡被别单占用：支付时部分发货停留 delivering，补货后重试成功", async () => {
    const p = seedAutoProduct(["C1", "C2"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 2, slug: p.slug });
    const o = getOrder(r.orderNo);

    // 建单后、支付前，C1 被其他订单卖掉
    db.update(cards)
      .set({ status: "sold", orderId: "LS_other_order", soldAt: new Date() })
      .where(eq(cards.content, "C1"))
      .run();

    handlePaymentNotify("mock", paySuccess(r.orderNo));
    expect(getOrder(r.orderNo).status).toBe("delivering");
    expect(getOrder(r.orderNo).paidAt).not.toBeNull();

    // 补货
    db.insert(cards).values({ productId: o.productId!, content: "C3", status: "available" }).run();
    const retry = retryAutoDelivery(r.orderNo);
    expect(retry.ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("completed");
    expect(getOrder(r.orderNo).deliveryContent?.split("\n").sort()).toEqual(["C2", "C3"]);
  });

  it("金额篡改被拒绝", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const result = handlePaymentNotify("mock", paySuccess(r.orderNo, { amountCents: 1n }));
    expect(result.handled).toBe(false);
    expect(result.message).toContain("金额不匹配");
    expect(getOrder(r.orderNo).status).toBe("pending");
    expect(db.select().from(cards).where(eq(cards.status, "sold")).all()).toHaveLength(0);
  });

  it("trade_id 不匹配被拒绝", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const result = handlePaymentNotify("mock", paySuccess(r.orderNo, { tradeId: "forged_trade" }));
    expect(result.handled).toBe(false);
    expect(result.message).toContain("trade_id");
    expect(getOrder(r.orderNo).status).toBe("pending");
  });

  it("签名错误被拒绝，且不落库（防止未认证请求写满磁盘）", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const body = JSON.parse(paySuccess(r.orderNo)) as Record<string, unknown>;
    body["signature"] = "deadbeef";
    const result = handlePaymentNotify("mock", JSON.stringify(body));
    expect(result.handled).toBe(false);
    expect(result.message).toContain("签名");
    // 关键：验签失败的请求不写入 notify_logs
    expect(db.select().from(notifyLogs).all()).toHaveLength(0);
    // 但保留轻量计数，保证攻击可见
    const stats = getRejectedNotifyStats();
    const total = Object.values(stats).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThan(0);
  });

  it("验签成功的通知仍写入完整审计记录", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    handlePaymentNotify("mock", paySuccess(r.orderNo));
    const logs = db.select().from(notifyLogs).all();
    expect(logs.length).toBeGreaterThanOrEqual(1);
    // 完整报文保留，供对账
    expect(logs[0].payload.length).toBeGreaterThan(10);
  });

  it("支付超时回调：pending → expired", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      tradeId: getOrder(r.orderNo).tradeId!,
      amountCents: r.totalCents,
      status: 3,
    });
    const result = handlePaymentNotify("mock", body);
    expect(result.handled).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("closed");
  });
});

describe("manual 商品全链路", () => {
  it("支付后停留 paid，人工发货后 completed，买家可见交付内容", async () => {
    const p = seedManualProduct(5);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 2, slug: p.slug });

    // 下单即扣库存 5-2=3
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(3);

    handlePaymentNotify("mock", paySuccess(r.orderNo));
    expect(getOrder(r.orderNo).status).toBe("paid");

    const view1 = lookupOrder(r.orderNo, "buyer@test.dev");
    expect(view1?.statusLabel).toContain("处理中");
    expect(view1?.deliveryContent).toBeNull();

    const done = manualDeliver(r.orderNo, "账号: user1 / 密码: pass123");
    expect(done.ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("completed");

    const view2 = lookupOrder(r.orderNo, "buyer@test.dev");
    expect(view2?.deliveryContent).toBe("账号: user1 / 密码: pass123");

    // 关闭已完成订单被拒绝（禁止硬删除已产生交易关联的数据）
    expect(closeOrder(r.orderNo).ok).toBe(false);
  });

  it("关闭未支付 manual 订单回补库存", async () => {
    const p = seedManualProduct(2);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 2, slug: p.slug });
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(0);

    expect(closeOrder(r.orderNo).ok).toBe(true);
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(2);
    expect(getOrder(r.orderNo).status).toBe("closed");
  });
});

describe("回跳页受限视图", () => {
  it("不含交付内容，且不泄露邮箱线索", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "someone@example.com", quantity: 1, slug: p.slug });
    handlePaymentNotify("mock", paySuccess(r.orderNo));

    const v = getOrderStatusView(r.orderNo);
    expect(v?.status).toBe("completed");
    expect(v?.deliveryContent).toBeNull();
    // 仅凭订单号即可访问 → 不得返回可推测的脱敏邮箱
    expect(v?.emailMasked).toBe("***");
  });
});

describe("下单锁定卡密（v1.3）", () => {
  it("下单即 reserved：可用余量减少；支付后转 sold", async () => {
    const p = seedAutoProduct(["C1", "C2"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });

    // 下单即占卡：可用 1、占用 1
    expect(db.select().from(cards).where(eq(cards.status, "available")).all()).toHaveLength(1);
    expect(db.select().from(cards).where(eq(cards.status, "reserved")).all()).toHaveLength(1);

    handlePaymentNotify("mock", paySuccess(r.orderNo));
    expect(getOrder(r.orderNo).status).toBe("completed");
    expect(db.select().from(cards).where(eq(cards.status, "sold")).all()).toHaveLength(1);
    expect(db.select().from(cards).where(eq(cards.status, "available")).all()).toHaveLength(1);
  });

  it("待支付超时：释放锁定卡密", async () => {
    const p = seedAutoProduct(["C1", "C2"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    expect(db.select().from(cards).where(eq(cards.status, "available")).all()).toHaveLength(1);

    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      tradeId: getOrder(r.orderNo).tradeId!,
      amountCents: r.totalCents,
      status: 3,
    });
    handlePaymentNotify("mock", body);

    expect(getOrder(r.orderNo).status).toBe("closed");
    // 锁定释放：可用恢复为 2
    expect(db.select().from(cards).where(eq(cards.status, "available")).all()).toHaveLength(2);
    expect(db.select().from(cards).where(eq(cards.status, "reserved")).all()).toHaveLength(0);
  });

  it("库存不足直接拒单（不产生待支付订单）", async () => {
    const p = seedAutoProduct(["C1"]);
    await expect(
      createOrder({ email: "buyer@test.dev", quantity: 2, slug: p.slug })
    ).rejects.toThrow(/库存不足/);
    // 事务回滚：不产生订单，也不占卡
    expect(db.select().from(orders).all()).toHaveLength(0);
    expect(db.select().from(cards).where(eq(cards.status, "available")).all()).toHaveLength(1);
  });

  it("卡密允许重复导入与重复销售", async () => {
    const p = seedAutoProduct([]);
    const r1 = await importCards(p.id, "TEST-KEY-001\nTEST-KEY-001");
    expect(r1.imported).toBe(2);
    const rows = db.select().from(cards).where(eq(cards.productId, p.id)).all();
    expect(rows).toHaveLength(2);

    // 两笔订单可以各自卖同一内容的卡
    const o1 = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const o2 = await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    handlePaymentNotify("mock", paySuccess(o1.orderNo));
    handlePaymentNotify("mock", paySuccess(o2.orderNo));
    const c1 = lookupOrder(o1.orderNo, "a@test.dev");
    const c2 = lookupOrder(o2.orderNo, "b@test.dev");
    expect(c1?.deliveryContent).toBe("TEST-KEY-001");
    expect(c2?.deliveryContent).toBe("TEST-KEY-001");
  });
});

describe("买家自助取消订单（仅未支付）", () => {
  it("取消待支付 auto 订单并释放锁定卡密", async () => {
    const p = seedAutoProduct(["C1", "C2"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    // 下单即占卡
    expect(db.select().from(cards).where(eq(cards.status, "reserved")).all()).toHaveLength(1);

    const res = cancelPendingOrder(r.orderNo, "buyer@test.dev");
    expect(res.ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("closed");
    // 占用释放，可用恢复
    expect(db.select().from(cards).where(eq(cards.status, "reserved")).all()).toHaveLength(0);
    expect(db.select().from(cards).where(eq(cards.status, "available")).all()).toHaveLength(2);
  });

  it("取消待支付 manual 订单回补库存", async () => {
    const p = seedManualProduct(2);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(1);

    expect(cancelPendingOrder(r.orderNo, "buyer@test.dev").ok).toBe(true);
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(2);
  });

  it("邮箱不匹配时拒绝取消（防枚举他人订单）", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });

    const res = cancelPendingOrder(r.orderNo, "attacker@test.dev");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("不匹配");
    expect(getOrder(r.orderNo).status).toBe("pending");
  });

  it("邮箱大小写不敏感", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "Buyer@Test.Dev", quantity: 1, slug: p.slug });
    expect(cancelPendingOrder(r.orderNo, "buyer@test.dev").ok).toBe(true);
  });

  it("已支付订单不可取消", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    handlePaymentNotify("mock", paySuccess(r.orderNo));
    expect(getOrder(r.orderNo).status).toBe("completed");

    const res = cancelPendingOrder(r.orderNo, "buyer@test.dev");
    expect(res.ok).toBe(false);
    expect(getOrder(r.orderNo).status).toBe("completed");
  });

  it("已超时订单不可取消且提示无需取消", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    handlePaymentNotify(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        tradeId: getOrder(r.orderNo).tradeId!,
        amountCents: r.totalCents,
        status: 3,
      })
    );
    const res = cancelPendingOrder(r.orderNo, "buyer@test.dev");
    expect(res.ok).toBe(false);
    // 超时终态是 closed → 走「已支付或已关闭」分支（expired 仅历史数据）
    expect(res.message).toContain("无法取消");
  });

  it("取消后清理 paymentUrl，订单查询页不再显示继续支付", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    expect(lookupOrder(r.orderNo, "buyer@test.dev")!.paymentUrl).toBeTruthy();

    cancelPendingOrder(r.orderNo, "buyer@test.dev");
    const view = lookupOrder(r.orderNo, "buyer@test.dev");
    expect(view!.status).toBe("closed");
    expect(view!.paymentUrl).toBeNull();
  });
});

describe("支付有效期展示（回归：不得渲染 1970 纪元）", () => {
  it("正常订单展示北京时间有效期", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const view = lookupOrder(r.orderNo, "buyer@test.dev")!;
    expect(view.expiresAtText).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(view.expiresAtText).not.toContain("1970");
  });

  it("expiration_time 为空时不展示有效期（修复 1970-01-01 08:00）", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    db.update(orders)
      .set({ expirationTime: null })
      .where(eq(orders.orderNo, r.orderNo))
      .run();

    const view = lookupOrder(r.orderNo, "buyer@test.dev")!;
    expect(view.status).toBe("pending");
    expect(view.expiresAtText).toBeNull();
  });

  it("epoch 0 视为非法有效期，返回 null", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    db.update(orders)
      .set({ expirationTime: new Date(0) })
      .where(eq(orders.orderNo, r.orderNo))
      .run();
    expect(lookupOrder(r.orderNo, "buyer@test.dev")!.expiresAtText).toBeNull();
  });
});

describe("安全回归：伪造回调防护", () => {
  it("缺少 trade_id 的回调被拒绝（不得因省略字段绕过校验）", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const realTradeId = getOrder(r.orderNo).tradeId!;

    // 构造一份「无 trade_id」的合法签名回调（模拟攻击者省略该字段）
    const unsigned: Record<string, unknown> = {
      order_id: r.orderNo,
      amount: Number(r.totalCents) / 100,
      actual_amount: (Number(r.totalCents) / 100).toFixed(6),
      token: "0x",
      block_transaction_id: "0xforged",
      status: 2,
    };
    const { epusdtSign } = await import("@/lib/signature");
    const forged = JSON.stringify({
      ...unsigned,
      signature: epusdtSign(unsigned, process.env.MOCK_PAYMENT_TOKEN || "mock-token"),
    });

    const result = handlePaymentNotify("mock", forged);
    expect(result.handled).toBe(false);
    expect(result.message).toContain("trade_id");
    expect(getOrder(r.orderNo).status).toBe("pending");
    // 卡密不得被卖出
    expect(db.select().from(cards).where(eq(cards.status, "sold")).all()).toHaveLength(0);
    // 真实 trade_id 仍然有效（确保只拦伪造、不误伤正品）
    const ok = handlePaymentNotify("mock", paySuccess(r.orderNo, { tradeId: realTradeId }));
    expect(ok.handled).toBe(true);
  });

  it("生产驱动（非 mock）下 mock 回调入口被拒绝", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });

    const prev = process.env.PAYMENT_DRIVER;
    process.env.PAYMENT_DRIVER = "bepusdt";
    try {
      const body = paySuccess(r.orderNo);
      const result = handlePaymentNotify("mock", body);
      expect(result.handled).toBe(false);
      expect(result.retryable).toBe(false);
      expect(result.message).toContain("未启用");
      expect(getOrder(r.orderNo).status).toBe("pending");
      expect(db.select().from(cards).where(eq(cards.status, "sold")).all()).toHaveLength(0);
    } finally {
      process.env.PAYMENT_DRIVER = prev;
    }
  });

  it("isProviderEnabled 仅在 driver=mock 时承认 mock", async () => {
    const { isProviderEnabled } = await import("@/server/payment");
    const prev = process.env.PAYMENT_DRIVER;
    try {
      process.env.PAYMENT_DRIVER = "mock";
      expect(isProviderEnabled("mock")).toBe(true);
      process.env.PAYMENT_DRIVER = "auto";
      expect(isProviderEnabled("mock")).toBe(false);
      process.env.PAYMENT_DRIVER = "bepusdt";
      expect(isProviderEnabled("mock")).toBe(false);
      // bepusdt 在任意驱动下都属已知渠道（其回调由签名+配置保护）
      expect(isProviderEnabled("bepusdt")).toBe(true);
    } finally {
      process.env.PAYMENT_DRIVER = prev;
    }
  });
});

describe("超卖回归：manual 库存扣到 0 后必须拒绝下单", () => {
  it("库存 1 件时，第二单必须被拒（历史 bug：0 被当作不限）", async () => {
    const p = seedManualProduct(1);
    const r1 = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    expect(r1.orderNo).toBeTruthy();
    // 扣减到 0
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(0);

    // 关键断言：第二单必须抛 OUT_OF_STOCK，而不是被当作"不限库存"放行
    await expect(
      createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug })
    ).rejects.toThrow(/库存不足/);
  });

  it("不限库存（-1）可重复下单且不被扣减", async () => {
    const p = seedManualProduct(-1);
    await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    // 始终保持 -1，未被扣减
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(-1);
  });

  it("有限库存扣减后关单可正确回补", async () => {
    const p = seedManualProduct(3);
    const r = await createOrder({ email: "a@test.dev", quantity: 2, slug: p.slug });
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(1);
    expect(closeOrder(r.orderNo).ok).toBe(true);
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(3);
  });

  it("售罄（0）商品不可下单", async () => {
    const p = seedManualProduct(0);
    // 全新商品直接置 0 = 售罄，应拒绝
    await expect(
      createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug })
    ).rejects.toThrow(/库存不足/);
  });
});
