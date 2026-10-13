import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, orders, paymentAnomalies, paymentAttempts } from "@/db/schema";
import { epusdtSign } from "@/lib/signature";
import { seedAuto } from "./test-helpers";
import { createOrder } from "./create-order";
import { closeOrder, handlePaymentNotify } from "./fulfill-order";
import { buildMockNotifyBody } from "@/server/payment/mock";
import { reissueAnomaly } from "@/server/admin/anomalies";

const states = ["pending", "paid", "delivering", "reconciling", "expired", "closed", "completed"] as const;
const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;
const anomalies = (no: string) => db.select().from(paymentAnomalies).where(eq(paymentAnomalies.orderNo, no)).all();
async function fixture(state: typeof states[number]) {
  const p = seedAuto([randomUUID(), randomUUID()]);
  const r = await createOrder({ slug: p.slug, email: "review@example.test", quantity: 1 });
  const o = getOrder(r.orderNo);
  const oldTrade = randomUUID();
  db.insert(paymentAttempts).values({ orderNo: o.orderNo, provider: "mock", tradeId: oldTrade,
    amountCents: o.totalCents, currency: o.currency, expectedActualAmount: "1.000000",
    status: "expired", isCurrent: false }).run();
  db.update(orders).set({ expectedActualAmount: "1.000000" }).where(eq(orders.orderNo, o.orderNo)).run();
  db.update(paymentAttempts).set({ expectedActualAmount: "1.000000" }).where(eq(paymentAttempts.tradeId, o.tradeId!)).run();
  if (state === "closed") expect(closeOrder(o.orderNo).ok).toBe(true);
  else if (state === "expired" || state === "completed") {
    handlePaymentNotify("mock", buildMockNotifyBody({ orderNo: o.orderNo, tradeId: o.tradeId!,
      amountCents: BigInt(o.totalCents), currency: o.currency, status: state === "expired" ? 3 : 2 }));
  } else db.update(orders).set({ status: state }).where(eq(orders.orderNo, o.orderNo)).run();
  return { o: getOrder(o.orderNo), oldTrade, p };
}
function signed(o: ReturnType<typeof getOrder>, tradeId: string, actual = "1.000000", amount = 1) {
  const body = { order_id: o.orderNo, trade_id: tradeId, amount, actual_amount: actual,
    status: 2, block_transaction_id: randomUUID() };
  return JSON.stringify({ ...body, signature: epusdtSign(body, process.env.MOCK_PAYMENT_TOKEN || "mock-token") });
}

describe("成功回调按支付尝试分类（P2-01/P2-02）", () => {
  for (const state of states) {
    for (const kind of ["historical", "historical-amount-mismatch", "current-amount-mismatch", "unknown"] as const) {
      it(`${state}: ${kind}`, async () => {
        const { o, oldTrade, p } = await fixture(state);
        const before = db.select().from(cards).where(eq(cards.productId, p.id)).all();
        const trade = kind === "unknown" ? randomUUID() : kind === "current-amount-mismatch" ? o.tradeId! : oldTrade;
        const actual = kind.includes("mismatch") ? "2.000000" : "1.000000";
        const result = handlePaymentNotify("mock", signed(o, trade, actual));
        expect(result.handled).toBe(false);
        expect(getOrder(o.orderNo)).toEqual(o);
        expect(db.select().from(cards).where(eq(cards.productId, p.id)).all()).toEqual(before);
        const rows = anomalies(o.orderNo);
        expect(rows).toHaveLength(kind === "historical" ? 1 : 0);
        if (kind === "historical") {
          expect(rows[0].tradeId).toBe(oldTrade);
          // 不同原始报文，验证业务幂等而非仅 hash 去重。
          handlePaymentNotify("mock", signed(o, oldTrade, "1.0000"));
          expect(anomalies(o.orderNo)).toHaveLength(1);
          if (state === "completed") expect(reissueAnomaly(rows[0].id, "核对").ok).toBe(false);
        }
        expect(db.select().from(paymentAttempts).where(and(eq(paymentAttempts.orderNo, o.orderNo),
          eq(paymentAttempts.tradeId, oldTrade))).get()!.status).toBe("expired");
      });
    }
  }
  it("当前交易完成后重复通知不登记异常，也不再次交付", async () => {
    const { o, p } = await fixture("completed");
    const before = db.select().from(cards).where(eq(cards.productId, p.id)).all();
    expect(handlePaymentNotify("mock", signed(o, o.tradeId!)).handled).toBe(true);
    expect(anomalies(o.orderNo)).toHaveLength(0);
    expect(db.select().from(cards).where(eq(cards.productId, p.id)).all()).toEqual(before);
  });
  it("历史交易法币金额不匹配时不登记", async () => {
    const { o, oldTrade } = await fixture("pending");
    expect(handlePaymentNotify("mock", signed(o, oldTrade, "1", 2)).handled).toBe(false);
    expect(anomalies(o.orderNo)).toHaveLength(0);
  });
  it("历史交易渠道不匹配时不登记", async () => {
    const { o, oldTrade } = await fixture("pending");
    db.update(paymentAttempts).set({ provider: "bepusdt" }).where(eq(paymentAttempts.tradeId, oldTrade)).run();
    expect(handlePaymentNotify("mock", signed(o, oldTrade)).handled).toBe(false);
    expect(anomalies(o.orderNo)).toHaveLength(0);
  });
});
