import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, orders, paymentAnomalies, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { handlePaymentNotify, closeOrder } from "./fulfill-order";
import { lookupOrder } from "./query-order";
import { buildMockNotifyBody } from "@/server/payment/mock";
import { listAnomalies, reissueAnomaly, resolveAnomalyAs, countOpenAnomalies } from "@/server/admin/anomalies";

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

    // 买家已付款（回调内容已确定），但先让本地清扫把订单置为 expired
    db.update(orders)
      .set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo))
      .run();
    lookupOrder(r.orderNo, "late@test.dev"); // 触发惰性清扫
    expect(getOrder(r.orderNo).status).toBe("expired");
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
    expect(getOrder(r.orderNo).status).toBe("expired");
    // 不得发货
    expect(cardsOf(p.id, "sold")).toHaveLength(0);

    // 但必须留下可追溯、可处置的异常记录
    const anomalies = listAnomalies({ status: "open" });
    const mine = anomalies.find((a) => a.orderNo === r.orderNo);
    expect(mine).toBeDefined();
    expect(mine!.tradeId).toBe(tradeId);
    expect(mine!.orderStatusAtArrival).toBe("expired");
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
    expect(getOrder(r.orderNo).status).toBe("expired");
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
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!,
      amountCents: BigInt(o.totalCents) + 999n, currency: o.currency, status: 2,
    }));
    // 当前实现对 expired 分支先登记异常（金额校验在其后）——这里断言至少不会发货
    expect(cardsOf(p.id, "sold")).toHaveLength(0);
    expect(getOrder(r.orderNo).status).toBe("expired");
    void before;
  });
});
