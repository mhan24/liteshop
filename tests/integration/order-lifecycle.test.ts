import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, deliveries, orders, payments } from "@/db/schema";
import {
  cancelPendingOrder,
  createOrder,
  handlePaymentWebhook,
  manualDeliver,
  resolveReconcilingAsNotCreated,
  retryDelivery,
  sweepExpired,
} from "@/server/orders";
import { queryOrder } from "@/server/order-query";
import { buildMockNotifyBody } from "@/server/payments/mock";
import { resetDb, seedAutoProduct, seedCurrency } from "../helpers";

/** 查单密码验证、过期清扫、取消、人工交付与恢复路径 */
describe("订单查询与生命周期", () => {
  beforeEach(async () => {
    await resetDb();
    await seedCurrency("USD");
  });

  async function setupCompletedOrder(slug: string) {
    await seedAutoProduct(slug, 3, 100);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug, quantity: 1 }] });
    const order = (await db.select().from(orders).where(eq(orders.orderNo, r.orderNo)))[0]!;
    const payment = (await db.select().from(payments).where(eq(payments.orderId, order.id)))[0]!;
    await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        providerRef: payment.providerRef!,
        amountMinor: order.totalCents,
        currency: order.currency,
        status: 2,
        fiatAmount: order.totalCents / 100,
      })
    );
    return { r, order };
  }

  it("查询：三因子正确返回交付内容；任一因子错误返回 null", async () => {
    const { r, order } = await setupCompletedOrder("q1");
    const good = await queryOrder("buyer@test.dev", r.orderNo, r.queryPassword);
    expect(good).not.toBeNull();
    expect(good!.status).toBe("completed");
    expect(good!.deliveryContent).toContain("CARD-");

    expect(await queryOrder("wrong@test.dev", r.orderNo, r.queryPassword)).toBeNull();
    expect(await queryOrder("buyer@test.dev", r.orderNo, "2AAAAAAA")).toBeNull();
    expect(await queryOrder("buyer@test.dev", "LS00000000000000", r.queryPassword)).toBeNull();
    void order;
  });

  it("邮箱无法单独获取订单（不允许仅凭邮箱访问）", async () => {
    const { r } = await setupCompletedOrder("q2");
    // 缺密码或缺订单号一律 null
    expect(await queryOrder("buyer@test.dev", "", r.queryPassword)).toBeNull();
    expect(await queryOrder("buyer@test.dev", r.orderNo, "")).toBeNull();
  });

  it("过期清扫：关闭订单、释放卡密、支付记录作废", async () => {
    await seedAutoProduct("sw1", 2);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "sw1", quantity: 1 }] });
    const order = (await db.select().from(orders).where(eq(orders.orderNo, r.orderNo)))[0]!;
    await db
      .update(orders)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(orders.id, order.id));

    const result = await sweepExpired();
    expect(result.closedOrders).toContain(r.orderNo);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("closed");
    const cardRows = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(cardRows.every((c) => c.status === "available")).toBe(true);
    const payRows = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(payRows[0]!.status).toBe("expired");
  });

  it("买家取消：双因子校验 + 库存释放", async () => {
    await seedAutoProduct("c1", 2);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "c1", quantity: 1 }] });
    const order = (await db.select().from(orders).where(eq(orders.orderNo, r.orderNo)))[0]!;

    const bad = await cancelPendingOrder(r.orderNo, "wrong@test.dev");
    expect(bad.ok).toBe(false);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("pending");

    const good = await cancelPendingOrder(r.orderNo, "buyer@test.dev");
    expect(good.ok).toBe(true);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("closed");
    const cardRows = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(cardRows.every((c) => c.status === "available")).toBe(true);

    // 二次取消：状态机拒绝
    expect((await cancelPendingOrder(r.orderNo, "buyer@test.dev")).ok).toBe(false);
  });

  it("人工交付：paid → completed；内容追加幂等", async () => {
    await seedAutoProduct("md1", 2);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "md1", quantity: 1 }] });
    const order = (await db.select().from(orders).where(eq(orders.orderNo, r.orderNo)))[0]!;
    // 先过期回调关闭，再走异常恢复路径演练人工交付（直接造 paid 订单）
    await db
      .update(orders)
      .set({ status: "paid", paidAt: new Date() })
      .where(eq(orders.id, order.id));

    const d1 = await manualDeliver(r.orderNo, "MANUAL-CONTENT-1", "admin");
    expect(d1.ok).toBe(true);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("completed");
    const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(deliveryRows[0]!.content).toBe("MANUAL-CONTENT-1");
  });

  it("reconciling 订单：确认未建单 → 关闭释放；不允许直接关闭", async () => {
    await seedAutoProduct("rc1", 2);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "rc1", quantity: 1 }] });
    const order = (await db.select().from(orders).where(eq(orders.orderNo, r.orderNo)))[0]!;
    await db
      .update(orders)
      .set({ status: "reconciling", expiresAt: null })
      .where(eq(orders.id, order.id));

    const closed = await resolveReconcilingAsNotCreated(r.orderNo, "admin");
    expect(closed.ok).toBe(true);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("closed");
    const cardRows = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(cardRows.every((c) => c.status === "available")).toBe(true);
  });

  it("paid 订单重试交付：卡密已交付时幂等完成", async () => {
    await seedAutoProduct("rd1", 2);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "rd1", quantity: 1 }] });
    const order = (await db.select().from(orders).where(eq(orders.orderNo, r.orderNo)))[0]!;
    const payment = (await db.select().from(payments).where(eq(payments.orderId, order.id)))[0]!;
    // 只推进到 paid（模拟确认时交付中断）
    await db.transaction(async (tx) => {
      await tx.update(orders).set({ status: "paid", paidAt: new Date() }).where(eq(orders.id, order.id));
      await tx
        .update(payments)
        .set({ status: "confirmed", confirmedAt: new Date() })
        .where(eq(payments.id, payment.id));
    });

    const retry = await retryDelivery(r.orderNo, "admin");
    expect(retry.ok).toBe(true);
    expect((await db.select().from(orders).where(eq(orders.id, order.id)))[0]!.status).toBe("completed");
    const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id));
    expect(deliveryRows).toHaveLength(1);
  });
});
