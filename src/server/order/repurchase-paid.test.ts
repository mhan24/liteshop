import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, paymentAnomalies } from "@/db/schema";
import { seedAuto } from "./test-helpers";

/**
 * 已付款的订单不得重新购买 —— 即使管理员已将其关闭。
 *
 * 状态机允许 paid → closed，而重购只检查 status，不检查是否实际收款。
 * 结果：买家付款后被关闭的订单仍会显示「重新购买」，
 * 可能误导已付款的买家再次支付（虽不会自动重复扣款）。
 */

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;
const countOrders = (email: string) =>
  db.select().from(orders).all().filter((o) => o.email === email).length;

describe("重购边界：已付款订单", () => {
  it("已付款后被管理员关闭的订单，不得重新购买", async () => {
    const { createOrder, createOrderForRepurchase } = await import("./create-order");
    const p = seedAuto(["C1", "C2", "C3"]);
    const r = await createOrder({ email: "paid-close@test.dev", quantity: 1, slug: p.slug });

    // 付款成功 → paid
    const { handlePaymentNotify } = await import("./fulfill-order");
    const { buildMockNotifyBody } = await import("@/server/payment/mock");
    const o = getOrder(r.orderNo);
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));
    expect(getOrder(r.orderNo).status).toBe("completed");

    // 管理员关闭（这里用 completed→closed 会失败，改为构造 paid→closed 场景）
    const { closeOrder } = await import("./fulfill-order");
    db.update(orders).set({ status: "paid", paidAt: new Date() }).where(eq(orders.orderNo, r.orderNo)).run();
    expect(closeOrder(r.orderNo).ok).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("closed");
    expect(getOrder(r.orderNo).paidAt).not.toBeNull(); // 有付款记录

    // 不得重新购买
    await expect(createOrderForRepurchase(r.orderNo, "paid-close@test.dev")).rejects.toThrow(
      /已付款|无法重新购买|客服/
    );
    expect(countOrders("paid-close@test.dev")).toBe(1);
  });

  it("存在未处理异常到账的过期订单，不得重新购买（防买家重复付款）", async () => {
    const { createOrder, createOrderForRepurchase } = await import("./create-order");
    const { handlePaymentNotify } = await import("./fulfill-order");
    const { sweepExpiredOrders } = await import("./expire-orders");
    const { buildMockNotifyBody } = await import("@/server/payment/mock");

    const p = seedAuto(["C1", "C2", "C3"]);
    const r = await createOrder({ email: "anom-exp@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);

    // 订单超时 → 清扫置为 expired
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();
    expect(getOrder(r.orderNo).status).toBe("expired");

    // 延迟的成功回调 → 登记为异常到账（待人工处置）
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents),
      currency: o.currency, status: 2,
    }));
    const anomaly = db.select().from(paymentAnomalies)
      .where(eq(paymentAnomalies.orderNo, r.orderNo)).get();
    expect(anomaly?.status).toBe("open");

    // 该订单虽已 expired，但有未处理的到账异常 → 不得重购
    await expect(createOrderForRepurchase(r.orderNo, "anom-exp@test.dev")).rejects.toThrow(
      /待处理|异常|到账|客服/
    );
    expect(countOrders("anom-exp@test.dev")).toBe(1);
  });

  it("对照组：未付款的 expired 订单仍可正常重购", async () => {
    const { createOrder, createOrderForRepurchase } = await import("./create-order");
    const p = seedAuto(["C1", "C2", "C3"]);
    const r = await createOrder({ email: "clean-exp@test.dev", quantity: 1, slug: p.slug });
    db.update(orders).set({ status: "expired", stockCharged: false })
      .where(eq(orders.orderNo, r.orderNo)).run();

    const fresh = await createOrderForRepurchase(r.orderNo, "clean-exp@test.dev");
    expect(fresh.orderNo).not.toBe(r.orderNo);
    expect(countOrders("clean-exp@test.dev")).toBe(2);
  });
});
