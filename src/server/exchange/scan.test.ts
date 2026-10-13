import { eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { cards, orders, products } from "@/db/schema";
import { createOrder } from "@/server/order/create-order";
import { saveExchangeChannel } from "./channel";
import { scanExchangePayments } from "./scan";

/**
 * 交易所收款端到端（用 mock 币安 API 响应替代真实接口）。
 *
 * 验证「订单 → 唯一金额 → 模拟到账 → 自动发货 → 异常分支」这条主链路，
 * 确保轮询通道与网关回调在结算上**行为一致**（都走同一个 processNotify）。
 */

function seedAutoProduct(cardContents: string[], priceCents: number) {
  const slug = `exch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({ name: "交易所商品", slug, description: "d", priceCents, deliveryType: "auto", status: "on" })
    .returning({ id: products.id })
    .get()!;
  for (const c of cardContents) {
    db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  }
  return { id: p.id, slug };
}

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

/** 启用一个"配置完整"的币安渠道（站点币种 USD，rate=1 → 应付金额 == 订单金额） */
function enableBinance(rate = "1") {
  const res = saveExchangeChannel("binance", {
    enabled: true,
    accountId: "12345",
    asset: "USDT",
    rate,
    apiKey: "test-key",
    apiSecret: "test-secret",
  });
  expect(res.ok).toBe(true);
}

/** mock 币安 /sapi/v1/pay/transactions 响应 */
function mockBinance(rows: unknown[]) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      // 凭据校验接口也返回可用 uid
      if (url.includes("/api/v3/account")) {
        return new Response(JSON.stringify({ uid: 12345 }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: "000000", success: true, data: rows }), {
        status: 200,
      });
    })
  );
}

function binanceRow(tradeId: string, amount: string, tsMs: number) {
  return {
    transactionId: tradeId,
    transactionTime: tsMs,
    receiverInfo: { binanceId: 12345 },
    fundsDetail: [{ amount, currency: "USDT" }],
  };
}

beforeEach(() => {
  // 站点币种固定 USD，便于「rate=1 时应付 == 订单金额」的直观断言
  db.update(products).set({ currency: "USD" }).run();
  // 扫描会考虑**所有**待支付的交易所订单（这是正确行为），
  // 但测试库是共享的，上一用例残留的待支付订单会抢走本用例的到账。
  // 因此每个用例前清理上一用例留下的交易所订单。
  db.delete(orders)
    .where(sql`${orders.expectedActualAmount} is not null`)
    .run();
});

afterEach(() => vi.unstubAllGlobals());

describe("交易所收款：轮询结算", () => {
  it("订单标记为交易所渠道后，模拟到账 → 自动发货完成", async () => {
    // 让 createOrder 走交易所渠道：需要 provider 可解析
    const prev = process.env.PAYMENT_DRIVER;
    process.env.PAYMENT_DRIVER = "mock"; // 下单仍用 mock 建 trade_id，随后手工改为交易所应付金额
    const p = seedAutoProduct(["C1"], 500); // $5.00
    const r = await createOrder({ email: "e1@test.dev", quantity: 1, slug: p.slug });
    process.env.PAYMENT_DRIVER = prev;

    // 把该订单标记为交易所渠道应付（格式 "<金额> <币种>"）
    db.update(orders).set({ expectedActualAmount: "5.11 USDT" }).where(eq(orders.orderNo, r.orderNo)).run();

    enableBinance("1");
    mockBinance([binanceRow("TX1", "5.11", Date.now())]);

    const res = await scanExchangePayments();
    expect(res.provider).toBe("binance");
    expect(res.settled.length).toBe(1);
    expect(res.settled[0].orderNo).toBe(r.orderNo);

    const o = getOrder(r.orderNo);
    expect(o.status).toBe("completed");
    expect(o.tradeId).toBe("TX1");
    expect(o.deliveryContent).toBeTruthy();
  });

  it("少付的到账不改变订单状态（真实短款，不得自动发货）", async () => {
    const prev = process.env.PAYMENT_DRIVER;
    process.env.PAYMENT_DRIVER = "mock";
    const p = seedAutoProduct(["C1"], 500);
    const r = await createOrder({ email: "e2@test.dev", quantity: 1, slug: p.slug });
    process.env.PAYMENT_DRIVER = prev;

    db.update(orders).set({ expectedActualAmount: "5.22 USDT" }).where(eq(orders.orderNo, r.orderNo)).run();

    enableBinance("1");
    // 实付 4.00 < 应付 5.22 → 短款，一律不自动履约
    mockBinance([binanceRow("TX2", "4.00", Date.now())]);

    const res = await scanExchangePayments();
    expect(res.settled).toHaveLength(0);
    expect(res.unmatched.length).toBeGreaterThan(0);
    expect(getOrder(r.orderNo).status).not.toBe("completed");
  });

  it("多付零头仍按原价成交（商家吸收）", async () => {
    const prev = process.env.PAYMENT_DRIVER;
    process.env.PAYMENT_DRIVER = "mock";
    const p = seedAutoProduct(["C1"], 500);
    const r = await createOrder({ email: "e2b@test.dev", quantity: 1, slug: p.slug });
    process.env.PAYMENT_DRIVER = prev;
    db.update(orders).set({ expectedActualAmount: "5.33 USDT" }).where(eq(orders.orderNo, r.orderNo)).run();

    enableBinance("1");
    mockBinance([binanceRow("TX2B", "5.35", Date.now())]); // 多付 0.02

    const res = await scanExchangePayments();
    expect(res.settled).toHaveLength(1);
    expect(getOrder(r.orderNo).status).toBe("completed");
  });

  it("重复扫描同一笔到账 → 幂等，不重复发货", async () => {
    const prev = process.env.PAYMENT_DRIVER;
    process.env.PAYMENT_DRIVER = "mock";
    const p = seedAutoProduct(["C1"], 500);
    const r = await createOrder({ email: "e3@test.dev", quantity: 1, slug: p.slug });
    process.env.PAYMENT_DRIVER = prev;
    db.update(orders).set({ expectedActualAmount: "5.44 USDT" }).where(eq(orders.orderNo, r.orderNo)).run();

    enableBinance("1");
    mockBinance([binanceRow("TX3", "5.44", Date.now())]);

    const first = await scanExchangePayments();
    expect(first.settled).toHaveLength(1);
    await scanExchangePayments(); // 第二次扫描：应幂等跳过
    // 第二次订单已完成（终态）→ 不再自动匹配；且不产生新的发货
    expect(getOrder(r.orderNo).status).toBe("completed");
    // 卡只卖出一张
    const sold = db.select().from(cards).all().filter((c) => c.productId === p.id && c.status === "sold");
    expect(sold).toHaveLength(1);
  });

  it("未配置渠道时安全跳过（不报错）", async () => {
    // 关闭渠道
    saveExchangeChannel("binance", {
      enabled: false,
      accountId: "",
      asset: "USDT",
      rate: "1",
      apiKey: "",
    });
    const res = await scanExchangePayments();
    expect(res.skipped).toBeTruthy();
    expect(res.settled).toHaveLength(0);
  });
});
describe("结算归属校验的纵深防御（直接调用结算入口，绕过扫描层）", () => {
  it("金额不足时，即使扫描层被绕过也拒绝发货", async () => {
    // 绕过 matchTransactions，直接调用 settleExchangePayment：
    // 验证 fulfill 层仍会独立校验金额，而不是只依赖上游过滤。
    const prev = process.env.PAYMENT_DRIVER;
    process.env.PAYMENT_DRIVER = "mock";
    const p = seedAutoProduct(["C1"], 500);
    const r = await createOrder({ email: "defense@test.dev", quantity: 1, slug: p.slug });
    process.env.PAYMENT_DRIVER = prev;
    db.update(orders).set({ expectedActualAmount: "5.00 USDT" }).where(eq(orders.orderNo, r.orderNo)).run();

    const { settleExchangePayment } = await import("@/server/order/fulfill-order");
    // 强行给一个金额不足的到账（这正是扫描层若失效会造成的后果）
    const res = settleExchangePayment({
      provider: "binance",
      orderNo: r.orderNo,
      tradeId: "TXDEF1",
      amount: "1.00",
      paidAt: new Date(),
      raw: null,
    });

    expect(res.handled).toBe(false);
    expect(res.message).toMatch(/金额不足|不匹配/);
    expect(getOrder(r.orderNo).status).not.toBe("completed");
  });

  it("缺少应付金额快照时拒绝（防止无归属证明就发货）", async () => {
    const prev = process.env.PAYMENT_DRIVER;
    process.env.PAYMENT_DRIVER = "mock";
    const p = seedAutoProduct(["C1"], 500);
    const r = await createOrder({ email: "defense2@test.dev", quantity: 1, slug: p.slug });
    process.env.PAYMENT_DRIVER = prev;
    // 不设置 expectedActualAmount

    const { settleExchangePayment } = await import("@/server/order/fulfill-order");
    const res = settleExchangePayment({
      provider: "binance",
      orderNo: r.orderNo,
      tradeId: "TXDEF2",
      amount: "5.00",
      paidAt: new Date(),
      raw: null,
    });
    expect(res.handled).toBe(false);
    expect(getOrder(r.orderNo).status).not.toBe("completed");
  });
});
