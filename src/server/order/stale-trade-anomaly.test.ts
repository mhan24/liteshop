import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, paymentAnomalies, paymentAttempts } from "@/db/schema";
import { seedAuto } from "./test-helpers";

/**
 * 复审 P2：已验签、金额正确的成功回调若携带**过期** trade_id，
 * 会被归属校验拒绝，但**不会**登记异常到账 —— 买家真实付的钱
 * 只留在普通通知日志里，人工对账队列发现不了。
 */

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

describe("旧交易的到账必须进入异常队列", () => {
  it("过期 trade_id 的成功回调：不发货，但登记异常到账", async () => {
    const { createOrder } = await import("./create-order");
    const { handlePaymentNotify } = await import("./fulfill-order");
    const { buildMockNotifyBody } = await import("@/server/payment/mock");

    const p = seedAuto(["C1", "C2"]);
    const r = await createOrder({ email: "stale@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    const currentTrade = o.tradeId!;

    // 模拟「订单有过多次支付尝试」：插入一条已过期的旧 attempt，
    // 并让当前 attempt 指向新的 trade_id
    db.insert(paymentAttempts)
      .values({
        orderNo: r.orderNo,
        provider: "mock",
        tradeId: "OLD_TRADE_EXPIRED",
        amountCents: Number(o.totalCents),
        currency: o.currency,
        paymentUrl: "https://gw/old",
        expectedActualAmount: null,
        expirationTime: new Date(Date.now() - 60_000),
        status: "expired",
        isCurrent: false,
        raw: null,
      })
      .run();
    db.update(paymentAttempts)
      .set({ isCurrent: true })
      .where(eq(paymentAttempts.tradeId, currentTrade))
      .run();
    db.update(orders).set({ tradeId: "NEW_TRADE_CURRENT" }).where(eq(orders.orderNo, r.orderNo)).run();

    // 买家付款到了**旧交易**地址 → 网关推送成功回调
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo,
      tradeId: "OLD_TRADE_EXPIRED",
      amountCents: BigInt(o.totalCents),
      currency: o.currency,
      status: 2,
    }));

    // 不得自动发货（归属校验必须拦住）
    expect(res.handled).toBe(false);
    expect(getOrder(r.orderNo).status).toBe("pending");

    // 关键：必须登记异常到账，让管理员知道有钱要核对
    const anomaly = db.select().from(paymentAnomalies)
      .where(eq(paymentAnomalies.orderNo, r.orderNo)).get();
    expect(anomaly).toBeDefined();
    expect(anomaly!.tradeId).toBe("OLD_TRADE_EXPIRED");
    expect(anomaly!.status).toBe("open");
  });

  it("普通未付款 pending 订单收到成功回调仍正常履约（回归保护）", async () => {
    const { createOrder } = await import("./create-order");
    const { handlePaymentNotify } = await import("./fulfill-order");
    const { buildMockNotifyBody } = await import("@/server/payment/mock");

    const p = seedAuto(["C1"]);
    const r = await createOrder({ email: "normal2@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));
    expect(res.handled).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("completed");
  });
});
