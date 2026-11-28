import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, deliveries, orders, payments } from "@/db/schema";
import { adminCloseOrder, createOrder, handlePaymentWebhook, resumePayment, retryDelivery } from "@/server/orders";
import { buildMockNotifyBody, mockAdapter } from "@/server/payments/mock";
import { orderWithPayment, payOrderWithMock, resetDb, seedAutoProduct } from "../helpers";

/** 审计回归：发卡补货重试、全有或全无、支付尝试异常安全、重新支付并发与认领 */
describe("发卡恢复与支付尝试", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  async function orderRow(orderNo: string) {
    return (await db.select().from(orders).where(eq(orders.orderNo, orderNo)))[0]!;
  }

  it("锁定的卡被删 → 支付后停在 paid 且不卖出任何卡；补货后重试发卡成功", async () => {
    const { productId } = await seedAutoProduct("rs1", 2);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "rs1", quantity: 2 }] });
    const order = await orderRow(r.orderNo);
    // 后台误删一张已锁定的卡（旧实现允许）
    const held = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    await db.delete(cards).where(eq(cards.id, held[0]!.id));

    await expect(payOrderWithMock(r.orderNo)).rejects.toThrow(/卡密不足/);
    expect((await orderRow(r.orderNo)).status).toBe("paid");
    // 全有或全无：剩下那张仍是 reserved，没有被「卖出却不交付」
    const after = await db.select().from(cards).where(eq(cards.productId, productId));
    expect(after.map((c) => c.status)).toEqual(["reserved"]);
    expect(await db.select().from(deliveries).where(eq(deliveries.orderId, order.id))).toHaveLength(0);

    // 补货后重试：从 available 补锁并一次性交付两张
    await db.insert(cards).values({ productId, content: "CARD-RESTOCK-1" });
    const retry = await retryDelivery(r.orderNo, "admin");
    expect(retry.ok).toBe(true);
    expect((await orderRow(r.orderNo)).status).toBe("completed");
    const delivery = (await db.select().from(deliveries).where(eq(deliveries.orderId, order.id)))[0]!;
    expect(delivery.cardIds).toHaveLength(2);
    expect(delivery.content).toContain("CARD-RESTOCK-1");
    expect(delivery.content).toContain(held[1]!.content);
  });

  it("同一 slug 重复出现会合并为一行明细，交付内容不重复", async () => {
    await seedAutoProduct("dup1", 3);
    const r = await createOrder({
      email: "buyer@test.dev",
      items: [
        { slug: "dup1", quantity: 1 },
        { slug: "dup1", quantity: 1 },
      ],
    });
    await payOrderWithMock(r.orderNo);
    const order = await orderRow(r.orderNo);
    const delivery = (await db.select().from(deliveries).where(eq(deliveries.orderId, order.id)))[0]!;
    expect(delivery.cardIds).toHaveLength(2);
    expect(delivery.content.match(/CARD-dup1-/g)).toHaveLength(2);
  });

  it("网关适配器抛异常 → 订单进入 reconciling（不会停在无有效期的 pending）", async () => {
    await seedAutoProduct("ex1", 1);
    vi.spyOn(mockAdapter, "createPayment").mockRejectedValueOnce(new Error("boom"));
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "ex1", quantity: 1 }] });
    expect(r.reconciling).toBe(true);
    const order = await orderRow(r.orderNo);
    expect(order.status).toBe("reconciling");
    // 卡密保留（网关可能已建单）
    const held = await db.select().from(cards).where(eq(cards.reservedOrderId, order.id));
    expect(held.map((c) => c.status)).toEqual(["reserved"]);
    const pay = (await db.select().from(payments).where(eq(payments.orderId, order.id)))[0]!;
    expect(pay.status).toBe("pending");
  });

  it("建单响应返回前管理员关单，回填交易号但不再交给买家付款", async () => {
    await seedAutoProduct("close-during-create", 1);
    const original = mockAdapter.createPayment.bind(mockAdapter);
    let reportStarted!: (no: string) => void;
    const started = new Promise<string>((resolve) => { reportStarted = resolve; });
    let resume!: () => void;
    const gate = new Promise<void>((resolve) => { resume = resolve; });
    vi.spyOn(mockAdapter, "createPayment").mockImplementationOnce(async (gateway, input) => {
      reportStarted(input.orderNo);
      await gate;
      return original(gateway, input);
    });
    const creating = createOrder({ email: "buyer@test.dev", items: [{ slug: "close-during-create", quantity: 1 }] });
    const no = await started;
    try {
      expect((await adminCloseOrder(no, "admin")).ok).toBe(true);
    } finally {
      resume();
    }
    expect(await creating).toMatchObject({ orderNo: no, status: "closed", paymentUrl: null });
    const { payment } = await orderWithPayment(no);
    expect(payment.status).toBe("expired");
    expect(payment.providerRef).toBeTruthy();
  });

  it.each(["lost", "conflict", "rejected"])("早到的付款回调优先于后续建单结果：%s", async (response) => {
    await seedAutoProduct("early", 1);
    vi.spyOn(mockAdapter, "createPayment").mockImplementationOnce(async (gateway, input) => {
      const callback = await handlePaymentWebhook("mock", buildMockNotifyBody({
        orderNo: input.orderNo, providerRef: "early-ref", amountCents: input.amountCents, status: 2,
      }));
      expect(callback.handled).toBe(true);
      if (response === "lost") return { kind: "unknown", message: "响应丢失" };
      if (response === "rejected") return { kind: "rejected", message: "建单被拒绝" };
      return { kind: "created", payment: {
        providerRef: "different-ref", expectedAmount: null, paymentUrl: "/pay/mock",
        expiresAt: new Date(Date.now() + gateway.timeoutSeconds * 1000), raw: {},
      } };
    });
    const result = await createOrder({ email: "buyer@test.dev", items: [{ slug: "early", quantity: 1 }] });
    expect(result).toMatchObject({ status: "completed", reconciling: false, paymentUrl: null });
    expect(result.queryPassword).toBeTruthy();
    const { payment, order } = await orderWithPayment(result.orderNo);
    expect(payment).toMatchObject({ status: "confirmed", providerRef: "early-ref" });
    expect(await db.select().from(deliveries).where(eq(deliveries.orderId, order.id))).toHaveLength(1);
  });

  it("网关明确返回原交易已关闭时退库存并保留交易号", async () => {
    await seedAutoProduct("closed", 1);
    vi.spyOn(mockAdapter, "createPayment").mockResolvedValueOnce({
      kind: "closed", providerRef: "closed-ref", message: "网关订单已取消",
    });
    const result = await createOrder({ email: "buyer@test.dev", items: [{ slug: "closed", quantity: 1 }] });
    expect(result).toMatchObject({ status: "closed", paymentUrl: null });
    const { payment } = await orderWithPayment(result.orderNo);
    expect(payment).toMatchObject({ status: "expired", providerRef: "closed-ref" });
    expect((await db.select().from(cards))[0]!.status).toBe("available");
  });

  it("建单响应丢失（providerRef 为空）时验签回调可认领当前尝试并发卡", async () => {
    await seedAutoProduct("cl1", 1);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "cl1", quantity: 1 }] });
    const { order, payment } = await orderWithPayment(r.orderNo);
    await db.update(payments).set({ providerRef: null }).where(eq(payments.id, payment.id));

    const result = await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({ orderNo: r.orderNo, providerRef: "lost-ref-1", amountCents: order.totalCents, status: 2 })
    );
    expect(result.handled).toBe(true);
    expect((await orderRow(r.orderNo)).status).toBe("completed");
  });

  it("重新支付：需要查单密码；旧尝试作废，旧交易到账记 late", async () => {
    await seedAutoProduct("rp1", 1);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "rp1", quantity: 1 }] });
    const { order, payment: first } = await orderWithPayment(r.orderNo);

    expect((await resumePayment(r.orderNo, "buyer@test.dev", "")).ok).toBe(false);
    const resumed = await resumePayment(r.orderNo, "buyer@test.dev", r.queryPassword);
    expect(resumed.ok).toBe(true);
    expect(resumed.data?.paymentUrl).toBeTruthy();

    const current = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)));
    expect(current).toHaveLength(1);
    expect(current[0]!.id).not.toBe(first.id);

    const late = await handlePaymentWebhook(
      "mock",
      buildMockNotifyBody({ orderNo: r.orderNo, providerRef: first.providerRef!, amountCents: order.totalCents, status: 2 })
    );
    expect(late.handled).toBe(false);
    expect((await db.select().from(payments).where(eq(payments.id, first.id)))[0]!.status).toBe("late");
    expect((await orderRow(r.orderNo)).status).toBe("pending");
  });

  it("并发重新支付只会留下一条当前尝试", async () => {
    await seedAutoProduct("rp2", 1);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "rp2", quantity: 1 }] });
    const order = await orderRow(r.orderNo);
    await Promise.all(
      Array.from({ length: 4 }, () => resumePayment(r.orderNo, "buyer@test.dev", r.queryPassword))
    );
    const current = await db
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)));
    expect(current).toHaveLength(1);
  });
});
