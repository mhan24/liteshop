import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, orders, paymentAnomalies, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { handlePaymentNotify, closeOrder } from "./fulfill-order";
import { lookupOrder } from "./query-order";
import { buildMockNotifyBody } from "@/server/payment/mock";
import { listAnomalies, reissueAnomaly, resolveAnomalyAs, countOpenAnomalies } from "@/server/admin/anomalies";
import { sweepExpiredOrders } from "./expire-orders";

/**
 * 回归：买家在支付有效期内完成付款，但成功回调在本地清扫之后才到达。
 *
 *   14:19  买家完成链上付款
 *   14:20  本地清扫 → expired，卡密被释放
 *   14:21  成功回调到达 → 订单已 expired
 *
 * 预期：登记为「异常到账」待人工处置，**不自动恢复原订单**
 * （卡密可能已被他人买走，直接发卡会一卡多卖）。
 */

function seedProduct(cardContents: string[]) {
  const slug = `late-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "迟到回调测试",
      slug,
      description: "d",
      priceCents: 100,
      deliveryType: "auto",
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  for (const c of cardContents) {
    db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  }
  return { id: p.id, slug };
}

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;
const cardsOf = (pid: number, st: string) =>
  db.select().from(cards).where(eq(cards.productId, pid)).all().filter((c) => c.status === st);

describe("付款先于过期、回调晚于过期", () => {
  it("清扫使订单过期后收到成功回调 → 登记异常到账，不自动发货", async () => {
    const p = seedProduct(["C1", "C2"]);
    const r = await createOrder({ email: "late@test.dev", quantity: 1, slug: p.slug });
    const o0 = getOrder(r.orderNo);
    const tradeId = o0.tradeId!;

    // 买家已付款（回调内容已确定），但先让本地清扫把订单置为终态 closed
    db.update(orders)
      .set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo))
      .run();
    lookupOrder(r.orderNo, "late@test.dev"); // 触发惰性清扫
    expect(getOrder(r.orderNo).status).toBe("closed");
    // 卡密已被释放
    expect(cardsOf(p.id, "reserved")).toHaveLength(0);
    expect(cardsOf(p.id, "available")).toHaveLength(2);

    // 延迟的成功回调到达
    const res = handlePaymentNotify(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        tradeId,
        amountCents: BigInt(o0.totalCents),
        currency: o0.currency,
        status: 2,
      })
    );

    // 不应自动入账
    expect(res.handled).toBe(false);
    // 明确告知已登记待处理
    expect(res.message).toContain("异常到账");
    expect(getOrder(r.orderNo).status).toBe("closed");
    // 不得发货
    expect(cardsOf(p.id, "sold")).toHaveLength(0);

    // 但必须留下可追溯、可处置的异常记录
    const anomalies = listAnomalies({ status: "open" });
    const mine = anomalies.find((a) => a.orderNo === r.orderNo);
    expect(mine).toBeDefined();
    expect(mine!.tradeId).toBe(tradeId);
    expect(mine!.orderStatusAtArrival).toBe("closed");
    expect(mine!.kind).toBe("late_payment");
  });

  it("同一 trade_id 重复回调只登记一条异常（幂等）", async () => {
    const p = seedProduct(["C1"]);
    const r = await createOrder({ email: "late2@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "late2@test.dev");

    const body = buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    });
    handlePaymentNotify("mock", body);
    handlePaymentNotify("mock", body); // 重复投递

    const rows = db
      .select()
      .from(paymentAnomalies)
      .where(eq(paymentAnomalies.orderNo, r.orderNo))
      .all();
    expect(rows).toHaveLength(1);
  });

  it("管理员补发：从卡池重新取卡交付（不复用已释放的那张）", async () => {
    const p = seedProduct(["C1", "C2"]);
    const r = await createOrder({ email: "re@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "re@test.dev");
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));

    const anomaly = listAnomalies({ status: "open" }).find((a) => a.orderNo === r.orderNo)!;
    const res = reissueAnomaly(anomaly.id, "已核对链上到账，补发");
    expect(res.ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("completed");
    expect(getOrder(r.orderNo).deliveryContent).toBeTruthy();
    // 该异常记录已关闭（同文件其他用例可能仍有 open，故按 id 断言）
    expect(listAnomalies({ status: "reissued" }).some((a) => a.id === anomaly.id)).toBe(true);
    expect(listAnomalies({ status: "open" }).some((a) => a.id === anomaly.id)).toBe(false);
  });

  it("卡池不足时补发失败并保留待处理（不得发出空交付）", async () => {
    const p = seedProduct(["only-one"]);
    const r = await createOrder({ email: "short@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "short@test.dev");
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));

    // 唯一一张卡被别的订单先买走
    db.update(cards).set({ status: "sold", orderId: "OTHER" }).where(eq(cards.productId, p.id)).run();

    const anomaly = listAnomalies({ status: "open" }).find((a) => a.orderNo === r.orderNo)!;
    const res = reissueAnomaly(anomaly.id, "尝试补发");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("卡池不足");
    // 仍是待处理，订单未交付
    expect(getOrder(r.orderNo).status).not.toBe("completed");
  });

  it("标记退款后异常关闭且订单状态不变", async () => {
    const p = seedProduct(["C1"]);
    const r = await createOrder({ email: "ref@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "ref@test.dev");
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));

    const anomaly = listAnomalies({ status: "open" }).find((a) => a.orderNo === r.orderNo)!;
    const res = resolveAnomalyAs(anomaly.id, "refunded", "已退款给买家");
    expect(res.ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("closed");
    expect(cardsOf(p.id, "sold")).toHaveLength(0);
  });

  it("已关闭订单收到成功回调同样登记异常", async () => {
    const p = seedProduct(["C1"]);
    const r = await createOrder({ email: "closed@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    expect(closeOrder(r.orderNo).ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("closed");

    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));
    expect(res.message).toContain("异常到账");
    expect(getOrder(r.orderNo).status).toBe("closed");
  });

  it("金额不符的迟到回调不登记异常（可能是伪造或误配）", async () => {
    const p = seedProduct(["C1"]);
    const r = await createOrder({ email: "amt@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "amt@test.dev");

    const before = countOpenAnomalies();
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!,
      amountCents: BigInt(o.totalCents) + 999n, currency: o.currency, status: 2,
    }));

    // 关键断言：不得进入可补发队列
    expect(countOpenAnomalies()).toBe(before);
    expect(res.message).toContain("不匹配");
    expect(cardsOf(p.id, "sold")).toHaveLength(0);
    expect(getOrder(r.orderNo).status).toBe("closed");
  });

  it("缺少 trade_id 的迟到回调不登记异常", async () => {
    const p = seedProduct(["C1"]);
    const r = await createOrder({ email: "noid@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "noid@test.dev");

    const before = countOpenAnomalies();
    // 构造一份不带 trade_id 的已签名回调
    const { epusdtSign } = await import("@/lib/signature");
    const unsigned: Record<string, unknown> = {
      order_id: r.orderNo,
      amount: Number(o.totalCents) / 100,
      actual_amount: (Number(o.totalCents) / 100).toFixed(6),
      token: "0xmock",
      block_transaction_id: "0xnone",
      status: 2,
    };
    const forged = JSON.stringify({
      ...unsigned,
      signature: epusdtSign(unsigned, process.env.MOCK_PAYMENT_TOKEN || "mock-token"),
    });
    const res = handlePaymentNotify("mock", forged);

    expect(res.handled).toBe(false);
    expect(countOpenAnomalies()).toBe(before);
    expect(cardsOf(p.id, "sold")).toHaveLength(0);
  });

  it("其他订单的 trade_id 不登记异常（防跨订单错配）", async () => {
    const p = seedProduct(["C1", "C2"]);
    // 另一笔独立订单
    const other = await createOrder({ email: "other@test.dev", quantity: 1, slug: p.slug });
    const otherTrade = getOrder(other.orderNo).tradeId!;

    const r = await createOrder({ email: "mine@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "mine@test.dev");

    const before = countOpenAnomalies();
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo,
      tradeId: otherTrade, // ← 属于另一订单
      amountCents: BigInt(o.totalCents), currency: o.currency, status: 2,
    }));
    expect(res.handled).toBe(false);
    expect(countOpenAnomalies()).toBe(before);
  });

  it("actual_amount 与创建快照不一致时不登记异常", async () => {
    const p = seedProduct(["C1"]);
    const r = await createOrder({ email: "actual@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    // 人为写入一个与回调不符的创建快照
    db.update(orders).set({ expectedActualAmount: "999.000000", expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "actual@test.dev");

    const before = countOpenAnomalies();
    // buildMockNotifyBody 生成的 actual_amount = amount，与 999.000000 不符
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!,
      amountCents: BigInt(o.totalCents), currency: o.currency, status: 2,
    }));
    expect(res.handled).toBe(false);
    expect(countOpenAnomalies()).toBe(before);
  });
});

describe("人工发货商品的异常到账处置（P1-2）", () => {
  function seedManual(stockLimit: number) {
    const slug = `late-m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = db
      .insert(products)
      .values({
        name: "人工商品",
        slug,
        description: "d",
        priceCents: 100,
        deliveryType: "manual",
        stockLimit,
        status: "on",
      })
      .returning({ id: products.id })
      .get()!;
    return { id: p.id, slug };
  }

  async function makeAnomaly(slug: string, email: string) {
    const r = await createOrder({ email, quantity: 1, slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, email); // 触发清扫：订单 expired 且库存已回补
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));
    return { orderNo: r.orderNo, anomalyId: listAnomalies({ status: "open" }).find((a) => a.orderNo === r.orderNo)!.id };
  }

  it("自动发卡商品走 reissue；人工商品走 accept（不再必然失败）", async () => {
    const { acceptAnomalyForManualDelivery } = await import("@/server/admin/anomalies");
    const p = seedManual(3);
    const { orderNo, anomalyId } = await makeAnomaly(p.slug, "m1@test.dev");

    // 用自动补发接口应被拒绝并提示改用人工入口
    const wrong = reissueAnomaly(anomalyId, "x");
    expect(wrong.ok).toBe(false);
    expect(wrong.message).toContain("人工发货");

    // 正确入口：转入人工发货
    const ok = acceptAnomalyForManualDelivery(anomalyId, "已核实链上到账");
    expect(ok.ok).toBe(true);
    expect(getOrder(orderNo).status).toBe("paid");
    expect(listAnomalies({ status: "reissued" }).some((a) => a.id === anomalyId)).toBe(true);
  });

  it("库存不重复计数：转入人工发货后关闭订单只回补一次", async () => {
    const { acceptAnomalyForManualDelivery } = await import("@/server/admin/anomalies");
    const { closeOrder } = await import("./fulfill-order");
    const p = seedManual(3);
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(3);

    const { orderNo, anomalyId } = await makeAnomaly(p.slug, "m2@test.dev");
    // 清扫已回补 → 恢复为 3
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(3);

    expect(acceptAnomalyForManualDelivery(anomalyId, "核实").ok).toBe(true);
    // 重新占用一份 → 2
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(2);

    // 关闭该订单 → 回补一次 → 3（不得变成 4）
    expect(closeOrder(orderNo).ok).toBe(true);
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(3);
  });

  it("人工商品库存不足时拒绝转入（不产生负库存/超卖）", async () => {
    const { acceptAnomalyForManualDelivery } = await import("@/server/admin/anomalies");
    const p = seedManual(1);
    const { anomalyId } = await makeAnomaly(p.slug, "m3@test.dev");

    // 唯一库存被其他订单占用
    db.update(products).set({ stockLimit: 0 }).where(eq(products.id, p.id)).run();
    const res = acceptAnomalyForManualDelivery(anomalyId, "核实");
    expect(res.ok).toBe(false);
    expect(res.message).toContain("库存不足");
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(0);
  });

  it("不限库存（-1）的人工商品转入时不扣减库存", async () => {
    const { acceptAnomalyForManualDelivery } = await import("@/server/admin/anomalies");
    const p = seedManual(-1);
    const { orderNo, anomalyId } = await makeAnomaly(p.slug, "m4@test.dev");
    expect(acceptAnomalyForManualDelivery(anomalyId, "核实").ok).toBe(true);
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(-1);
    expect(getOrder(orderNo).status).toBe("paid");
  });
});

describe("P1 回归：异常到账处置以订单快照为准", () => {
  function seedAutoProduct(contents: string[]) {
    const slug = `anom-snap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = db
      .insert(products)
      .values({ name: "快照商品", slug, description: "d", priceCents: 100, deliveryType: "auto", status: "on" })
      .returning({ id: products.id })
      .get()!;
    for (const c of contents) db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
    return { id: p.id, slug };
  }

  it("原为自动发卡、商品后改人工：仍可用自动补发", async () => {
    const p = seedAutoProduct(["C1", "C2"]);
    const r = await createOrder({ email: "snap-anom@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "snap-anom@test.dev"); // 触发清扫
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));

    // 商品被改为人工发货（订单快照仍是 auto）
    db.update(products).set({ deliveryType: "manual" }).where(eq(products.id, p.id)).run();

    const anomaly = listAnomalies({ status: "open" }).find((a) => a.orderNo === r.orderNo)!;
    // 应走自动补发（依据订单快照），而不是被拒绝
    const res = reissueAnomaly(anomaly.id, "按订单快照补发");
    expect(res.ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("completed");
    expect(getOrder(r.orderNo).deliveryContent).toBeTruthy();
  });

  it("原为人工发货、商品后改自动：仍走人工入口", async () => {
    const { acceptAnomalyForManualDelivery } = await import("@/server/admin/anomalies");
    const slug = `anom-man-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = db
      .insert(products)
      .values({ name: "人工快照", slug, description: "d", priceCents: 100, deliveryType: "manual", stockLimit: 3, status: "on" })
      .returning({ id: products.id })
      .get()!;

    const r = await createOrder({ email: "snap-man@test.dev", quantity: 1, slug });
    const o = getOrder(r.orderNo);
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "snap-man@test.dev");
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));

    // 商品改为自动发卡（订单快照仍是 manual）
    db.update(products).set({ deliveryType: "auto" }).where(eq(products.id, p.id)).run();

    const anomaly = listAnomalies({ status: "open" }).find((a) => a.orderNo === r.orderNo)!;
    const res = acceptAnomalyForManualDelivery(anomaly.id, "按订单快照转入人工");
    expect(res.ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("paid");
  });
});

describe("P1 回归：有限库存改为不限后的释放", () => {
  it("不把 -1 加成为 0（不意外售罄）", async () => {
    const slug = `mode-fix-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = db
      .insert(products)
      .values({ name: "模式切换", slug, description: "d", priceCents: 100, deliveryType: "manual", stockLimit: 3, status: "on" })
      .returning({ id: products.id })
      .get()!;

    const r = await createOrder({ email: "modefix@test.dev", quantity: 1, slug });
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(2);

    db.update(products).set({ stockLimit: -1 }).where(eq(products.id, p.id)).run();
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    // 仍是不限，而不是 0（售罄）
    expect(db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit).toBe(-1);
  });
});
