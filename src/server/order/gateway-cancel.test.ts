import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { orders, paymentAttempts } from "@/db/schema";
import { epusdtSign } from "@/lib/signature";
import { upsertPaymentConfig } from "@/server/settings";
import { seedAuto } from "./test-helpers";

/**
 * 商户侧主动关单必须 best-effort 通知网关撤销未到账交易
 * （BEpusdt cancel-transaction，pay.9527.tr 对接文档的取消语义）：
 * - 管理员关闭 pending 订单 / 买家取消 pending 订单 → 触发
 * - 已有真实到账（attempt=paid）的订单不得撤销
 * - 网关拒绝/网络失败不阻断本地关单
 */

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

const uniqueTradeId = () => `LP_TEST_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;

const seedBepusdtConfig = () => {
  upsertPaymentConfig("bepusdt", {
    enabled: true,
    configJson: { api_base: "https://gw.cancel.test", token: "tok" },
  });
};

/** 建一个 pending 订单，并把当前支付尝试挂到 bepusdt 渠道 */
async function makeBepusdtPendingOrder(): Promise<{ orderNo: string; tradeId: string }> {
  const { createOrder } = await import("./create-order");
  const p = seedAuto(["G1"]);
  const r = await createOrder({ email: "cancel@test.dev", quantity: 1, slug: p.slug });
  const tradeId = uniqueTradeId();
  db.update(paymentAttempts)
    .set({ provider: "bepusdt", tradeId })
    .where(eq(paymentAttempts.orderNo, r.orderNo))
    .run();
  db.update(orders).set({ tradeId }).where(eq(orders.orderNo, r.orderNo)).run();
  return { orderNo: r.orderNo, tradeId };
}

interface CancelCall {
  url: string;
  body: Record<string, unknown>;
}

const stubCancelEndpoint = (calls: CancelCall[], statusBody?: { code: number; message: string }) => {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) as Record<string, unknown> });
      const payload = statusBody ?? { code: 200, message: "success" };
      return new Response(
        JSON.stringify({ status_code: payload.code, message: payload.message }),
        { status: 200 }
      );
    })
  );
};

describe("商户侧关单触发网关取消交易（cancel-transaction）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("管理员关闭 pending 订单 → 调用网关取消，签名合法", async () => {
    seedBepusdtConfig();
    const { orderNo, tradeId } = await makeBepusdtPendingOrder();
    const calls: CancelCall[] = [];
    stubCancelEndpoint(calls);

    const { closeOrder } = await import("./fulfill-order");
    const res = closeOrder(orderNo);
    expect(res.ok).toBe(true);
    expect(getOrder(orderNo).status).toBe("closed");

    // 取消是事务提交后的 best-effort 异步调用
    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].url).toBe("https://gw.cancel.test/api/v1/order/cancel-transaction");
    expect(calls[0].body["trade_id"]).toBe(tradeId);
    expect(epusdtSign({ trade_id: tradeId }, "tok")).toBe(calls[0].body["signature"]);
  });

  it("买家取消 pending 订单 → 同样触发网关取消", async () => {
    seedBepusdtConfig();
    const { orderNo, tradeId } = await makeBepusdtPendingOrder();
    const calls: CancelCall[] = [];
    stubCancelEndpoint(calls);

    const { cancelPendingOrder } = await import("./fulfill-order");
    const res = cancelPendingOrder(orderNo, "cancel@test.dev");
    expect(res.ok).toBe(true);
    expect(getOrder(orderNo).status).toBe("closed");

    await vi.waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0].body["trade_id"]).toBe(tradeId);
  });

  it("关闭 attempt 已到账（paid）的订单不触发网关取消", async () => {
    seedBepusdtConfig();
    const { orderNo } = await makeBepusdtPendingOrder();
    db.update(paymentAttempts).set({ status: "paid" }).where(eq(paymentAttempts.orderNo, orderNo)).run();
    const calls: CancelCall[] = [];
    stubCancelEndpoint(calls);

    const { closeOrder } = await import("./fulfill-order");
    const res = closeOrder(orderNo);
    expect(res.ok).toBe(true);
    expect(getOrder(orderNo).status).toBe("closed");
    // 给异步任务一个执行窗口后断言未发起请求
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
  });

  it("网关业务拒绝（status_code>=400）不影响本地关单", async () => {
    seedBepusdtConfig();
    const { orderNo } = await makeBepusdtPendingOrder();
    stubCancelEndpoint([], { code: 400, message: "订单不存在" });

    const { closeOrder } = await import("./fulfill-order");
    const res = closeOrder(orderNo);
    expect(res.ok).toBe(true);
    expect(getOrder(orderNo).status).toBe("closed");
    await vi.waitFor(() => expect(getOrder(orderNo).status).toBe("closed"));
  });

  it("非网关渠道（mock）关单不发起任何网关请求", async () => {
    const { createOrder } = await import("./create-order");
    const p = seedAuto(["G2"]);
    const r = await createOrder({ email: "mock-cancel@test.dev", quantity: 1, slug: p.slug });
    const calls: CancelCall[] = [];
    stubCancelEndpoint(calls);

    const { closeOrder } = await import("./fulfill-order");
    const res = closeOrder(r.orderNo);
    expect(res.ok).toBe(true);
    await new Promise((r) => setTimeout(r, 50));
    expect(calls).toHaveLength(0);
  });
});
