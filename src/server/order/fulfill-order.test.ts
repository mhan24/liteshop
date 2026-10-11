import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, notifyLogs, orders, products } from "@/db/schema";
import { buildMockNotifyBody } from "@/server/payment/mock";
import { handlePaymentNotify, manualDeliver, retryAutoDelivery, closeOrder } from "./fulfill-order";
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

  it("签名错误被拒绝且留痕", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "buyer@test.dev", quantity: 1, slug: p.slug });
    const body = JSON.parse(paySuccess(r.orderNo)) as Record<string, unknown>;
    body["signature"] = "deadbeef";
    const result = handlePaymentNotify("mock", JSON.stringify(body));
    expect(result.handled).toBe(false);
    expect(result.message).toContain("签名");
    const logs = db.select().from(notifyLogs).all();
    expect(logs).toHaveLength(1);
    expect(logs[0].handled).toBe(false);
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
    expect(getOrder(r.orderNo).status).toBe("expired");
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
  it("不含交付内容，含掩码邮箱", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "someone@example.com", quantity: 1, slug: p.slug });
    handlePaymentNotify("mock", paySuccess(r.orderNo));

    const v = getOrderStatusView(r.orderNo);
    expect(v?.status).toBe("completed");
    expect(v?.deliveryContent).toBeNull();
    expect(v?.emailMasked).toBe("so***@example.com");
  });
});
