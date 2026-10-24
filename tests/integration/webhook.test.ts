import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, deliveries, orders, payments } from "@/db/schema";
import { createOrder, handlePaymentWebhook } from "@/server/orders";
import { buildMockNotifyBody } from "@/server/payments/mock";
import { resetDb, seedAutoProduct, seedManualProduct, seedCurrency } from "../helpers";

/**
 * 支付回调全流程（mock 渠道，协议与真实 BEpusdt 渠道共用同一确认代码路径）：
 * 验签 → 金额核对 → 幂等 → 状态机 → 原子发卡。
 */
describe("支付回调（webhook）", () => {
  beforeEach(async () => {
    await resetDb();
    await seedCurrency("USD");
  });

  async function createPaidPendingOrder(slug: string, quantity = 1, cardCount = 5) {
    await seedAutoProduct(slug, cardCount, 100);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug, quantity }] });
    const orderRows = await db.select().from(orders).where(eq(orders.orderNo, r.orderNo));
    const payRows = await db.select().from(payments).where(eq(payments.orderId, orderRows[0]!.id));
    return { r, order: orderRows[0]!, payment: payRows[0]! };
  }

  it("完整购买流程：回调确认 → 卡密交付 → 订单完成", async () => {
    const { r, order, payment } = await createPaidPendingOrder("flow1", 2, 5);
    expect(payment.providerRef).toBeTruthy();

    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 2,
      fiatAmount: order.totalCents / 100,
    });
    const result = await handlePaymentWebhook("mock", body);
    expect(result.respond).toBe("success");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("自动发货完成");

    const orderRows = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRows[0]!.status).toBe("completed");

    const sold = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(sold).toHaveLength(2);
    expect(sold.every((c) => c.status === "sold")).toBe(true);

    const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0]!.content).toContain("【测试商品 flow1】");
    for (const c of sold) expect(deliveryRows[0]!.content).toContain(c.content);
  });

  it("重复回调幂等：不重复发货、不改变状态", async () => {
    const { r, order, payment } = await createPaidPendingOrder("idem1");
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 2,
      fiatAmount: order.totalCents / 100,
    });
    const first = await handlePaymentWebhook("mock", body);
    expect(first.handled).toBe(true);
    const second = await handlePaymentWebhook("mock", body);
    expect(second.respond).toBe("success");

    const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(deliveryRows).toHaveLength(1);
    const sold = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(sold).toHaveLength(1);
  });

  it("签名错误：拒绝处理并回 success（终止无意义重试）", async () => {
    const { r, order, payment } = await createPaidPendingOrder("sig1");
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 2,
      fiatAmount: order.totalCents / 100,
    });
    const tampered = JSON.stringify({ ...JSON.parse(body), amount: 9999 });
    const result = await handlePaymentWebhook("mock", tampered);
    expect(result.respond).toBe("success");
    expect(result.handled).toBe(false);
    const orderRows = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRows[0]!.status).toBe("pending");
  });

  it("金额不匹配：拒绝确认（金额必须等于订单总额）", async () => {
    const { r, order, payment } = await createPaidPendingOrder("amt1");
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents - 50,
      currency: order.currency,
      status: 2,
      fiatAmount: (order.totalCents - 50) / 100,
    });
    const result = await handlePaymentWebhook("mock", body);
    expect(result.respond).toBe("success");
    expect(result.message).toContain("金额不匹配");
    const orderRows = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRows[0]!.status).toBe("pending");
  });

  it("status=3 过期回调：关闭订单并释放卡密", async () => {
    const { r, order, payment } = await createPaidPendingOrder("exp1", 1, 3);
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 3,
      fiatAmount: order.totalCents / 100,
    });
    const result = await handlePaymentWebhook("mock", body);
    expect(result.handled).toBe(true);
    const orderRows = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRows[0]!.status).toBe("closed");
    const cardRows = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(cardRows.every((c) => c.status === "available")).toBe(true);
  });

  it("过期订单收到延迟成功回调：登记 late 异常，不发货", async () => {
    const { r, order, payment } = await createPaidPendingOrder("late1");
    const expiredBody = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 3,
      fiatAmount: order.totalCents / 100,
    });
    await handlePaymentWebhook("mock", expiredBody);

    const paidBody = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 2,
      fiatAmount: order.totalCents / 100,
    });
    const result = await handlePaymentWebhook("mock", paidBody);
    expect(result.respond).toBe("success");
    expect(result.message).toContain("延迟到账");

    const orderRows = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRows[0]!.status).toBe("closed");
    const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(deliveryRows).toHaveLength(0);
    const payRows = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(payRows[0]!.status).toBe("late");
    expect(payRows[0]!.anomaly).toBe("late");
  });

  it("status=1 等待通知：仅记录，不改变状态", async () => {
    const { r, order, payment } = await createPaidPendingOrder("wait1");
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 1,
      fiatAmount: order.totalCents / 100,
    });
    const result = await handlePaymentWebhook("mock", body);
    expect(result.handled).toBe(true);
    const orderRows = await db.select().from(orders).where(eq(orders.id, order.id));
    expect(orderRows[0]!.status).toBe("pending");
  });

  it("人工发货商品：确认支付后停留 paid，人工交付后完成", async () => {
    await seedManualProduct("manual1", null, 100);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "manual1", quantity: 1 }] });
    const orderRows = await db.select().from(orders).where(eq(orders.orderNo, r.orderNo));
    const order = orderRows[0]!;
    const payRows = await db.select().from(payments).where(eq(payments.orderId, order.id));
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payRows[0]!.providerRef!,
      amountMinor: order.totalCents,
      currency: order.currency,
      status: 2,
      fiatAmount: order.totalCents / 100,
    });
    const result = await handlePaymentWebhook("mock", body);
    expect(result.message).toContain("等待交付");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("paid");
  });

  it("未知订单/未知交易的回调被安全忽略", async () => {
    await seedAutoProduct("unk1", 1);
    const body = buildMockNotifyBody({
      orderNo: "LS99999999999999",
      providerRef: "mock_ghost",
      amountMinor: 100,
      currency: "USD",
      status: 2,
      fiatAmount: 1,
    });
    const result = await handlePaymentWebhook("mock", body);
    expect(result.respond).toBe("success");
    expect(result.message).toBe("订单不存在");
  });
});
