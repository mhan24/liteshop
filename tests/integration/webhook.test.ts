import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, deliveries, orders, payments } from "@/db/schema";
import { createOrder, handlePaymentWebhook } from "@/server/orders";
import { buildMockNotifyBody } from "@/server/payments/mock";
import { lipayTestHelpers } from "./litepay-fixture";
import { resetDb, seedAutoProduct } from "../helpers";

/**
 * 支付回调全流程：验签 → 金额核对 → 幂等 → 状态机 → 原子发卡。
 * mock 渠道用于覆盖确认代码路径；LitePay 渠道单独验真（签名、应答语义）。
 */
describe("支付回调（webhook）", () => {
  beforeEach(async () => {
    await resetDb();
  });

  async function createPendingOrder(slug: string, quantity = 1, cardCount = 5) {
    await seedAutoProduct(slug, cardCount, 100);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug, quantity }] });
    const orderRows = await db.select().from(orders).where(eq(orders.orderNo, r.orderNo));
    const payRows = await db.select().from(payments).where(eq(payments.orderId, orderRows[0]!.id));
    return { r, order: orderRows[0]!, payment: payRows[0]! };
  }

  it("完整购买流程：回调确认 → 卡密发放 → 订单完成", async () => {
    const { r, order, payment } = await createPendingOrder("flow1", 2, 5);
    expect(payment.providerRef).toBeTruthy();

    const result = await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        providerRef: payment.providerRef!,
        amountCents: order.totalCents,
        status: 2,
      })
    );
    expect(result.respond).toBe("success");
    expect(result.handled).toBe(true);
    expect(result.message).toContain("已确认支付并发放卡密");

    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("completed");

    const sold = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(sold).toHaveLength(2);
    expect(sold.every((c) => c.status === "sold")).toBe(true);

    const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(deliveryRows).toHaveLength(1);
    expect(deliveryRows[0]!.content).toContain("【测试商品 flow1】");
    for (const c of sold) expect(deliveryRows[0]!.content).toContain(c.content);
  });

  it("重复回调幂等：不重复发卡、不改变状态", async () => {
    const { r, order, payment } = await createPendingOrder("idem1");
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountCents: order.totalCents,
      status: 2,
    });
    expect((await handlePaymentWebhook("mock", body)).handled).toBe(true);
    const second = await handlePaymentWebhook("mock", body);
    expect(second.respond).toBe("success");

    const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(deliveryRows).toHaveLength(1);
    expect(await db.select().from(cards).where(eq(cards.reservedOrderId, order.id))).toHaveLength(1);
  });

  it("签名错误：拒绝处理并回 success（终止无意义重试）", async () => {
    const { r, order, payment } = await createPendingOrder("sig1");
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountCents: order.totalCents,
      status: 2,
    });
    const tampered = JSON.stringify({ ...JSON.parse(body), amount: 9999 });
    const result = await handlePaymentWebhook("mock", tampered);
    expect(result.respond).toBe("success");
    expect(result.handled).toBe(false);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("pending");
  });

  it("金额不匹配：拒绝确认（金额必须等于订单总额）", async () => {
    const { r, order, payment } = await createPendingOrder("amt1");
    const result = await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        providerRef: payment.providerRef!,
        amountCents: order.totalCents - 50,
        status: 2,
      })
    );
    expect(result.respond).toBe("success");
    expect(result.message).toContain("金额不匹配");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("pending");
  });

  it("非成功通知（status≠2）：记录后忽略，订单不变", async () => {
    const { r, order, payment } = await createPendingOrder("wait1");
    const result = await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        providerRef: payment.providerRef!,
        amountCents: order.totalCents,
        status: 1,
      })
    );
    expect(result.respond).toBe("success");
    expect(result.message).toContain("已忽略");
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("pending");
  });

  it("已关闭订单收到成功回调：登记 late 异常，不发卡", async () => {
    const { r, order, payment } = await createPendingOrder("late1");
    await db.update(orders).set({ status: "closed" }).where(eq(orders.id, order.id));

    const result = await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        providerRef: payment.providerRef!,
        amountCents: order.totalCents,
        status: 2,
      })
    );
    expect(result.respond).toBe("success");
    expect(result.message).toContain("延迟到账");

    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("closed");
    expect(await db.select().from(deliveries).where(eq(deliveries.orderId, order.id))).toHaveLength(0);
    const payRows = await db.select().from(payments).where(eq(payments.id, payment.id));
    expect(payRows[0]!.status).toBe("late");
    expect(payRows[0]!.anomaly).toBe("late");
  });

  it("未知订单/未知交易的回调被安全忽略", async () => {
    const result = await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({
        orderNo: "LS99999999999999",
        providerRef: "mock_ghost",
        amountCents: 100,
        status: 2,
      })
    );
    expect(result.respond).toBe("success");
    expect(result.message).toBe("订单不存在");
  });
});

describe("LitePay 渠道回调", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("签名正确的成功回调：确认支付并发放卡密", async () => {
    const { r, order, payment } = await lipayTestHelpers.prepareLitepayOrder("lp1");
    const body = lipayTestHelpers.signedNotify({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountCents: order.totalCents,
      status: 2,
    });

    const result = await handlePaymentWebhook("litepay", body);
    expect(result.respond).toBe("success");
    expect(result.handled).toBe(true);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("completed");
    expect(await db.select().from(deliveries).where(eq(deliveries.orderId, order.id))).toHaveLength(1);
  });

  it("签名不符：拒绝处理，订单保持待支付", async () => {
    const { r, order, payment } = await lipayTestHelpers.prepareLitepayOrder("lp2");
    const body = lipayTestHelpers.signedNotify({
      orderNo: r.orderNo,
      providerRef: payment.providerRef!,
      amountCents: order.totalCents,
      status: 2,
    });
    const tampered = JSON.stringify({ ...JSON.parse(body), amount: 0.01 });

    const result = await handlePaymentWebhook("litepay", tampered);
    expect(result.respond).toBe("success");
    expect(result.handled).toBe(false);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("pending");
  });
});
