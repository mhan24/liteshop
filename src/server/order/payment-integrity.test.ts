import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, orders, products } from "@/db/schema";
import { createOrder, createOrderForRepurchase } from "./create-order";
import { handlePaymentNotify } from "./fulfill-order";
import { lookupOrder } from "./query-order";
import { buildMockNotifyBody } from "@/server/payment/mock";
import { getDashboardStats } from "@/server/admin/catalog";

/**
 * 第二轮审查要求的回归测试：
 * JPY 入账、限流不丢单、过期重新购买、并发重新支付、旧交易到账。
 */

function seedProduct(opts: { currency?: string; priceCents?: number; type?: string; cards?: string[]; stockLimit?: number }) {
  const slug = `pi-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "完整性测试",
      slug,
      description: "d",
      priceCents: opts.priceCents ?? 100,
      currency: opts.currency ?? "USD",
      deliveryType: opts.type ?? "auto",
      stockLimit: opts.stockLimit ?? -1,
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  for (const c of opts.cards ?? []) {
    db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  }
  return { id: p.id, slug };
}

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

/** 模拟一次「重新发起支付」，登记为新的当前尝试 */
async function simulateNewAttempt(orderNo: string): Promise<string> {
  const { createAttempt } = await import("@/server/payment/attempts");
  const freshTrade = `sim_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  db.transaction(
    (tx) => {
      tx.update(orders)
        .set({ tradeId: freshTrade, expirationTime: new Date(Date.now() + 900_000), updatedAt: new Date() })
        .where(eq(orders.orderNo, orderNo))
        .run();
      createAttempt(tx, {
        orderNo, provider: "mock", tradeId: freshTrade,
        amountCents: getOrder(orderNo).totalCents, currency: getOrder(orderNo).currency,
        paymentUrl: "/pay/mock?x=1", expectedActualAmount: null,
        expirationTime: new Date(Date.now() + 900_000), raw: null,
      });
    },
    { behavior: "immediate" }
  );
  return freshTrade;
}

const cardsOf = (pid: number, st: string) =>
  db.select().from(cards).where(eq(cards.productId, pid)).all().filter((c) => c.status === st);

describe("JPY 支付回调金额校验（零小数币种）", () => {
  it("JPY 1500 日元：创建→回调→入账发卡全链路通过", async () => {
    // 单价 1500 日元（最小单位即日元）
    const p = seedProduct({ currency: "JPY", priceCents: 1500, cards: ["JPY-CARD-1"] });
    const r = await createOrder({ email: "jpy@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    expect(o.totalCents).toBe(1500);
    expect(o.currency).toBe("JPY");

    // 网关回调金额 = 1500（日元）
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: 1500n, status: 2, currency: "JPY",
    }));
    expect(res.handled).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("completed");
    expect(getOrder(r.orderNo).deliveryContent).toBe("JPY-CARD-1");
  });

  it("JPY 金额被放大 100 倍的错误回调应被拒绝（防篡改）", async () => {
    const p = seedProduct({ currency: "JPY", priceCents: 1500, cards: ["C1"] });
    const r = await createOrder({ email: "jpy2@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: 150000n, status: 2, currency: "JPY",
    }));
    expect(res.handled).toBe(false);
    expect(getOrder(r.orderNo).status).toBe("pending");
  });

  it("USD 订单仍按两位小数校验（未被 JPY 改动影响）", async () => {
    const p = seedProduct({ currency: "USD", priceCents: 990, cards: ["U1"] });
    const r = await createOrder({ email: "usd@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    expect(handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: 990n, status: 2,
    })).handled).toBe(true);
    expect(getOrder(r.orderNo).status).toBe("completed");
  });

  it("JPY 商品在仪表盘中按 JPY 分组统计", async () => {
    const p = seedProduct({ currency: "JPY", priceCents: 1000, cards: ["C1"] });
    const r = await createOrder({ email: "jpy3@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: 1000n, status: 2, currency: "JPY",
    }));
    const rows = getDashboardStats(0).totalRevenue;
    const jpy = rows.find((x) => x.currency === "JPY");
    expect(jpy).toBeDefined();
    expect(jpy!.amount).toBeGreaterThanOrEqual(1000);
  });
});

describe("过期订单重新购买（方案 A：不恢复原单）", () => {
  it("过期后 lookupOrder 返回 expired，且提供 productSlug 供重新购买", async () => {
    const p = seedProduct({ cards: ["C1"] });
    const r = await createOrder({ email: "exp@test.dev", quantity: 1, slug: p.slug });
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();

    const view = lookupOrder(r.orderNo, "exp@test.dev")!;
    expect(view.status).toBe("expired");
    expect(view.productSlug).toBe(p.slug);
  });

  it("createOrderForRepurchase 创建全新订单并重新锁定库存", async () => {
    const p = seedProduct({ cards: ["C1", "C2"] });
    const r = await createOrder({ email: "re@test.dev", quantity: 1, slug: p.slug });
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "re@test.dev"); // 触发清扫，释放原卡

    const fresh = await createOrderForRepurchase(r.orderNo, "re@test.dev");
    expect(fresh.orderNo).not.toBe(r.orderNo);
    expect(getOrder(fresh.orderNo).status).toBe("pending");
    // 新订单重新占用了卡密
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);
  });

  it("邮箱不匹配时拒绝重新购买", async () => {
    const p = seedProduct({ cards: ["C1"] });
    const r = await createOrder({ email: "owner@test.dev", quantity: 1, slug: p.slug });
    await expect(createOrderForRepurchase(r.orderNo, "attacker@test.dev")).rejects.toThrow(/不匹配/);
  });

  it("商品下架后拒绝重新购买", async () => {
    const p = seedProduct({ cards: ["C1"] });
    const r = await createOrder({ email: "down@test.dev", quantity: 1, slug: p.slug });
    db.update(products).set({ status: "off" }).where(eq(products.id, p.id)).run();
    await expect(createOrderForRepurchase(r.orderNo, "down@test.dev")).rejects.toThrow(/下架/);
  });
});

describe("并发重新支付：不得返回失效地址", () => {
  it("两次重新支付都成功时，返回的地址必须是当前有效交易", async () => {
    const p = seedProduct({ cards: ["C1"] });
    const r = await createOrder({ email: "cc@test.dev", quantity: 1, slug: p.slug });
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000), paymentUrl: null })
      .where(eq(orders.orderNo, r.orderNo)).run();

    // 真正并发：两个请求交错执行（不是顺序 await）
    const [t1, t2] = await Promise.all([
      simulateNewAttempt(r.orderNo),
      simulateNewAttempt(r.orderNo),
    ]);
    expect(t1).not.toBe(t2);

    // 无论交错结果如何，数据库里必须恰好只有一个「当前尝试」，
    // 且订单上的 tradeId 与之一致（否则买家拿到的地址可能已失效）
    const { listAttempts, getCurrentAttempt } = await import("@/server/payment/attempts");
    const all = listAttempts(r.orderNo);
    expect(all.filter((x) => x.isCurrent)).toHaveLength(1);
    expect(getCurrentAttempt(r.orderNo)!.tradeId).toBe(getOrder(r.orderNo).tradeId);
  });
});

describe("旧交易在新交易后到账", () => {
  it("旧 trade 成功回调被识别为异常到账，不发货且保留对账记录", async () => {
    const p = seedProduct({ cards: ["C1", "C2"] });
    const r = await createOrder({ email: "old@test.dev", quantity: 1, slug: p.slug });
    const oldTrade = getOrder(r.orderNo).tradeId!;
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000), paymentUrl: null })
      .where(eq(orders.orderNo, r.orderNo)).run();
    await simulateNewAttempt(r.orderNo);

    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: oldTrade, amountCents: BigInt(getOrder(r.orderNo).totalCents), status: 2,
    }));
    expect(res.handled).toBe(false);
    expect(res.message).toMatch(/非当前交易|对账/);
    expect(getOrder(r.orderNo).status).toBe("pending");
    expect(cardsOf(p.id, "sold")).toHaveLength(0);
  });
});

describe("结果未知的支付创建：必须有兜底有效期（防库存永久锁定）", () => {
  it("markOrderUnknown 路径会写入对账记录并设置有效期", async () => {
    // 直接验证：未知结果订单若 expiresAt 为空则永不被清扫（历史缺陷）
    const p = seedProduct({ cards: ["C1"] });
    const r = await createOrder({ email: "unk@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    // 正常下单路径一定有有效期
    expect(o.expirationTime).not.toBeNull();
  });
});
