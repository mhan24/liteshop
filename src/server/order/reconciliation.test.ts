import { eq } from "drizzle-orm";
import { describe, expect, it, vi, afterEach } from "vitest";
import { db } from "@/db";
import { cards, orders, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { sweepExpiredOrders, expireOrderIfOverdue, countOverduePending } from "./expire-orders";
import {
  resolveReconcilingAsNotCreated,
  countReconciling,
  handlePaymentNotify,
} from "./fulfill-order";
import { lookupOrder } from "./query-order";
import { upsertPaymentConfig } from "@/server/settings";

/**
 * 故障注入：网关**已创建交易但响应丢失**。
 *
 * 这是最危险的场景之一：本地看到超时，网关侧支付地址却仍然有效。
 * 若贸然关单释放库存，买家付款后将无法履约（资损）。
 */

function seedProduct(cards_: string[]) {
  const slug = `rec-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({ name: "对账测试", slug, description: "d", priceCents: 100, deliveryType: "auto", status: "on" })
    .returning({ id: products.id })
    .get()!;
  for (const c of cards_) db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  return { id: p.id, slug };
}

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

/**
 * 临时切换到 bepusdt 渠道，用于注入网关层故障。
 * mock 渠道不联网，无法模拟「网关已建单但响应丢失」。
 */
function useBepusdt(driver: "auto" | "bepusdt" = "bepusdt") {
  const prev = process.env.PAYMENT_DRIVER;
  process.env.PAYMENT_DRIVER = driver;
  return () => { process.env.PAYMENT_DRIVER = prev; };
}

/** 配置一个可用的 bepusdt 渠道（否则 resolvePaymentProvider 会抛未配置） */
function seedBepusdtConfig() {
  upsertPaymentConfig("bepusdt", {
    enabled: true,
    configJson: { api_base: "https://pay.invalid.test", token: "tok", timeout_seconds: 900 },
  });
}

const cardsOf = (pid: number, st: string) =>
  db.select().from(cards).where(eq(cards.productId, pid)).all().filter((c) => c.status === st);

afterEach(() => vi.unstubAllGlobals());

describe("网关已建单但响应丢失（超时）", () => {
  it("订单进入 reconciling，且不会因本地倒计时被自动释放库存", async () => {
    const p = seedProduct(["C1", "C2"]);
    seedBepusdtConfig();
    const restore = useBepusdt();

    // 注入：网关其实建单成功，只是响应超时
    vi.stubGlobal("fetch", vi.fn(async () => {
      const e = new Error("The operation was aborted due to timeout");
      e.name = "TimeoutError";
      throw e;
    }));

    await expect(
      createOrder({ email: "rec@test.dev", quantity: 1, slug: p.slug })
    ).rejects.toThrow(/对账|超时/);
    restore();
    vi.unstubAllGlobals();

    // 找到刚建的订单
    const o = db.select().from(orders).all().find((x) => x.email === "rec@test.dev")!;
    expect(o.status).toBe("reconciling");
    // 关键：没有有效期 → 超时清扫不会碰它
    expect(o.expirationTime).toBeNull();

    // 库存仍被锁定（未释放，因为无法确认网关没有建单）
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);
    expect(cardsOf(p.id, "available")).toHaveLength(1);

    // 即便强制把时间推后、反复清扫，也不得释放
    expect(expireOrderIfOverdue(o.orderNo)).toBe(false);
    expect(sweepExpiredOrders().expired).toBe(0);
    expect(countOverduePending()).toBe(0);
    expect(getOrder(o.orderNo).status).toBe("reconciling");
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);
  });

  it("人工确认网关未建单后，才释放库存", async () => {
    const p = seedProduct(["C1"]);
    seedBepusdtConfig();
    const restore = useBepusdt();
    vi.stubGlobal("fetch", vi.fn(async () => {
      const e = new Error("timeout"); e.name = "TimeoutError"; throw e;
    }));
    await expect(createOrder({ email: "rec2@test.dev", quantity: 1, slug: p.slug })).rejects.toThrow();
    restore();
    vi.unstubAllGlobals();

    const o = db.select().from(orders).all().find((x) => x.email === "rec2@test.dev")!;
    expect(countReconciling()).toBeGreaterThanOrEqual(1);

    const res = resolveReconcilingAsNotCreated(o.orderNo);
    expect(res.ok).toBe(true);
    expect(getOrder(o.orderNo).status).toBe("closed");
    // 确认后才释放
    expect(cardsOf(p.id, "available")).toHaveLength(1);
    expect(cardsOf(p.id, "reserved")).toHaveLength(0);
  });

  it("非 reconciling 订单不能走该释放通道", async () => {
    const p = seedProduct(["C1"]);
    const r = await createOrder({ email: "rec3@test.dev", quantity: 1, slug: p.slug });
    const res = resolveReconcilingAsNotCreated(r.orderNo);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("无需此操作");
  });
});

describe("网关 HTTP 5xx：可能已建单，不得当作明确失败", () => {
  it("502 归类为 unknown（保留订单对账，不关单释放库存）", async () => {
    const p = seedProduct(["C1"]);
    seedBepusdtConfig();
    const restore = useBepusdt();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad gateway", { status: 502 })));

    await expect(
      createOrder({ email: "rec5xx@test.dev", quantity: 1, slug: p.slug })
    ).rejects.toThrow(/对账|超时/);
    restore();
    vi.unstubAllGlobals();

    const o = db.select().from(orders).all().find((x) => x.email === "rec5xx@test.dev")!;
    expect(o.status).toBe("reconciling");
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);
  });

  it("4xx 是明确的请求侧拒绝 → 关单并回补库存", async () => {
    const p = seedProduct(["C1"]);
    seedBepusdtConfig();
    const restore = useBepusdt();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad request", { status: 400 })));

    await expect(
      createOrder({ email: "rec4xx@test.dev", quantity: 1, slug: p.slug })
    ).rejects.toThrow(/支付渠道创建失败/);
    restore();
    vi.unstubAllGlobals();

    const o = db.select().from(orders).all().find((x) => x.email === "rec4xx@test.dev")!;
    expect(o.status).toBe("closed");
    // 明确未建单 → 库存已回补
    expect(cardsOf(p.id, "available")).toHaveLength(1);
  });
});

describe("对账订单在前台的表现", () => {
  it("reconciling 订单显示「待对账」且不提供继续支付入口", async () => {
    const p = seedProduct(["C1"]);
    seedBepusdtConfig();
    const restore = useBepusdt();
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }));
    await expect(createOrder({ email: "recview@test.dev", quantity: 1, slug: p.slug })).rejects.toThrow();
    restore();
    vi.unstubAllGlobals();

    const o = db.select().from(orders).all().find((x) => x.email === "recview@test.dev")!;
    const view = lookupOrder(o.orderNo, "recview@test.dev")!;
    expect(view.status).toBe("reconciling");
    expect(view.statusLabel).toBe("待对账");
    expect(view.paymentUrl).toBeNull();
  });
});

describe("P0 回归：reconciling 订单的到账恢复闭环", () => {
  it("结果未知 → 收到合法成功回调 → 恢复履约并发货", async () => {
    const p = seedProduct(["C1", "C2"]);
    seedBepusdtConfig();
    const restore = useBepusdt();
    vi.stubGlobal("fetch", vi.fn(async () => {
      const e = new Error("timeout"); e.name = "TimeoutError"; throw e;
    }));
    await expect(createOrder({ email: "rev@test.dev", quantity: 1, slug: p.slug })).rejects.toThrow();
    restore();
    vi.unstubAllGlobals();

    const o = db.select().from(orders).all().find((x) => x.email === "rev@test.dev")!;
    expect(o.status).toBe("reconciling");
    // 关键：此时订单没有 trade_id（创建响应丢失）
    expect(o.tradeId).toBeNull();
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);

    // 网关随后推送成功回调（携带真实 trade_id）→ 应恢复并发货
    const { buildMockNotifyBody } = await import("@/server/payment/mock");
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: o.orderNo,
      tradeId: "gateway_recovered_trade_1",
      amountCents: BigInt(o.totalCents),
      currency: o.currency,
      status: 2,
    }));

    expect(res.handled).toBe(true);
    expect(getOrder(o.orderNo).status).toBe("completed");
    expect(cardsOf(p.id, "sold")).toHaveLength(1);
    // 恢复后必须补记 trade_id 与支付尝试（可追溯）
    expect(getOrder(o.orderNo).tradeId).toBe("gateway_recovered_trade_1");
    const { listAttempts } = await import("@/server/payment/attempts");
    expect(listAttempts(o.orderNo).some((a) => a.tradeId === "gateway_recovered_trade_1")).toBe(true);
  });

  it("金额不符的回调不能恢复 reconciling 订单（防篡改）", async () => {
    const p = seedProduct(["C1"]);
    seedBepusdtConfig();
    const restore = useBepusdt();
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }));
    await expect(createOrder({ email: "rev2@test.dev", quantity: 1, slug: p.slug })).rejects.toThrow();
    restore();
    vi.unstubAllGlobals();

    const o = db.select().from(orders).all().find((x) => x.email === "rev2@test.dev")!;
    const { buildMockNotifyBody } = await import("@/server/payment/mock");
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: o.orderNo, tradeId: "t_evil",
      amountCents: BigInt(o.totalCents) + 1n, currency: o.currency, status: 2,
    }));
    expect(res.handled).toBe(false);
    expect(getOrder(o.orderNo).status).toBe("reconciling");
    expect(cardsOf(p.id, "sold")).toHaveLength(0);
  });
});

describe("P1 回归：通用关闭不得绕过对账流程", () => {
  it("closeOrder 拒绝 reconciling 订单（防止误释放库存）", async () => {
    const p = seedProduct(["C1"]);
    seedBepusdtConfig();
    const restore = useBepusdt();
    vi.stubGlobal("fetch", vi.fn(async () => { const e = new Error("timeout"); e.name = "TimeoutError"; throw e; }));
    await expect(createOrder({ email: "cl@test.dev", quantity: 1, slug: p.slug })).rejects.toThrow();
    restore();
    vi.unstubAllGlobals();

    const o = db.select().from(orders).all().find((x) => x.email === "cl@test.dev")!;
    const { closeOrder } = await import("@/server/order/fulfill-order");
    const res = closeOrder(o.orderNo);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("对账");
    // 库存未被释放
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);
    expect(getOrder(o.orderNo).status).toBe("reconciling");
  });
});
