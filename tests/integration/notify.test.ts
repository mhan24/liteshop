import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, notifications, orders } from "@/db/schema";
import { encryptSecret } from "@/lib/secret-box";
import { createOrder, handlePaymentWebhook, resolveReconcilingAsPaid, resumePayment } from "@/server/orders";
import { flushNotifications } from "@/server/notify";
import { updateConfig } from "@/server/settings";
import { buildMockNotifyBody, mockAdapter } from "@/server/payments/mock";
import { orderWithPayment, payOrderWithMock, resetDb, seedAutoProduct } from "../helpers";

const kinds = async () => (await db.select().from(notifications).orderBy(notifications.id)).map((n) => n.kind);

describe("运营通知", () => {
  beforeEach(async () => {
    await resetDb();
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("库存跌破阈值与售罄各只通知一次", async () => {
    await updateConfig({ lowStockThreshold: 3 });
    await seedAutoProduct("ls1", 4);
    await createOrder({ email: "a@test.dev", items: [{ slug: "ls1", quantity: 1 }] }); // 4 → 3：未跌破
    expect(await kinds()).toEqual([]);
    await createOrder({ email: "a@test.dev", items: [{ slug: "ls1", quantity: 1 }] }); // 3 → 2：跌破
    await createOrder({ email: "a@test.dev", items: [{ slug: "ls1", quantity: 1 }] }); // 2 → 1：不重复
    expect(await kinds()).toEqual(["stock_low"]);
    await createOrder({ email: "a@test.dev", items: [{ slug: "ls1", quantity: 1 }] }); // 1 → 0：售罄
    const all = await db.select().from(notifications);
    expect(all.map((n) => n.kind)).toEqual(["stock_low", "stock_low"]);
    expect(all[1]!.text).toContain("已售罄");
  });

  it("网关结果未知 → 待核实通知（含原因）", async () => {
    await seedAutoProduct("rc1", 20);
    vi.spyOn(mockAdapter, "createPayment").mockResolvedValueOnce({ kind: "unknown", message: "网关超时" });
    const r = await createOrder({ email: "a@test.dev", items: [{ slug: "rc1", quantity: 1 }] });
    const [n] = await db.select().from(notifications);
    expect(n?.kind).toBe("order_reconciling");
    expect(n?.text).toContain(r.orderNo);
    expect(n?.text).toContain("网关超时");
  });

  it("已付款但卡密不足 → 通知；人工确认到账卡密不足同样通知", async () => {
    await seedAutoProduct("pu1", 5);
    const r = await createOrder({ email: "a@test.dev", items: [{ slug: "pu1", quantity: 1 }] });
    const { order } = await orderWithPayment(r.orderNo);
    await db.delete(cards).where(eq(cards.reservedOrderId, order.id));
    await db.delete(cards); // 清空库存，补锁也失败
    await expect(payOrderWithMock(r.orderNo)).rejects.toThrow();
    expect(await kinds()).toContain("paid_undelivered");

    await seedAutoProduct("pu2", 1);
    vi.spyOn(mockAdapter, "createPayment").mockResolvedValueOnce({ kind: "unknown", message: "x" });
    const r2 = await createOrder({ email: "a@test.dev", items: [{ slug: "pu2", quantity: 1 }] });
    await db.delete(cards);
    await resolveReconcilingAsPaid(r2.orderNo, "admin");
    expect((await kinds()).filter((k) => k === "paid_undelivered")).toHaveLength(2);
  });

  it("延迟到账通知，网关重复推送不重复通知", async () => {
    await seedAutoProduct("lt1", 20);
    const r = await createOrder({ email: "a@test.dev", items: [{ slug: "lt1", quantity: 1 }] });
    const { order, payment: first } = await orderWithPayment(r.orderNo);
    await resumePayment(r.orderNo, "a@test.dev", r.queryPassword);
    const body = buildMockNotifyBody({ orderNo: r.orderNo, providerRef: first.providerRef!, amountCents: order.totalCents, status: 2 });
    await handlePaymentWebhook("mock", body);
    await handlePaymentWebhook("mock", body);
    expect((await kinds()).filter((k) => k === "payment_late")).toHaveLength(1);
  });

  it("业务回滚时不产生通知（与业务同一事务）", async () => {
    await updateConfig({ lowStockThreshold: 10 });
    await seedAutoProduct("rb1", 2);
    await expect(createOrder({ email: "a@test.dev", items: [{ slug: "rb1", quantity: 5 }] })).rejects.toThrow();
    expect(await kinds()).toEqual([]);
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("投递：未配置时跳过；成功标记已发；失败重试且错误信息不含令牌", async () => {
    await db.insert(notifications).values([{ kind: "test", text: "a" }, { kind: "test", text: "b" }]);
    expect((await flushNotifications()).skipped).toBe(true);

    await updateConfig({ telegramEnabled: true, telegramBotTokenEnc: encryptSecret("SECRET-TOKEN"), telegramChatId: "123" });
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ ok: true }), { status: 200 }))
      .mockRejectedValueOnce(new Error("connect failed https://api.telegram.org/botSECRET-TOKEN/sendMessage"));
    vi.stubGlobal("fetch", fetchMock);
    expect(await flushNotifications()).toEqual({ sent: 1, failed: 1, skipped: false });
    expect(String(fetchMock.mock.calls[0]![0])).toContain("SECRET-TOKEN");
    const rows = await db.select().from(notifications).orderBy(notifications.id);
    expect(rows[0]!.sentAt).not.toBeNull();
    expect(rows[1]!.attempts).toBe(1);
    expect(rows[1]!.lastError).not.toContain("SECRET-TOKEN");
  });
});
