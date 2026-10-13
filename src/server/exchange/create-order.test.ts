import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, products } from "@/db/schema";
import { saveExchangeChannel } from "./channel";
import { createExchangeOrder } from "./create-order";

/**
 * 唯一金额分配：这是交易所收款能自动匹配的根本保障。
 * 若两笔同价订单拿到相同应付金额，流水将无法区分 → 必须杜绝。
 */

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

function seedManual(priceCents: number, slugPrefix: string) {
  const slug = `${slugPrefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  db.insert(products)
    .values({
      name: "交易所人工商品",
      slug,
      description: "d",
      priceCents,
      currency: "USD",
      deliveryType: "manual",
      stockLimit: 100,
      status: "on",
    })
    .run();
  return { id: products, slug };
}

beforeEach(() => {
  // 测试库共享：清掉上一用例留下的交易所订单，否则它们的应付金额
  // 会继续占用唯一金额位，导致断言受执行顺序影响。
  db.delete(orders).where(sql`${orders.expectedActualAmount} is not null`).run();

  saveExchangeChannel("binance", {
    enabled: true,
    accountId: "12345",
    asset: "USDT",
    rate: "1", // 1 USDT = 1 USD，简化断言
    apiKey: "k",
    apiSecret: "s",
  });
});

describe("createExchangeOrder：唯一应付金额", () => {
  it("单笔订单：应付金额按汇率换算并写入订单", async () => {
    const p = seedManual(500, "ex1"); // $5.00
    const r = await createExchangeOrder({ slug: p.slug, email: "c1@test.dev", quantity: 1 });
    // rate=1，USD→USDT 1:1 → 5.00
    expect(r.payableAmount).toBe("5.00");
    expect(r.asset).toBe("USDT");
    const o = getOrder(r.orderNo);
    expect(o.expectedActualAmount).toBe("5.00 USDT");
    expect(o.status).toBe("pending");
    expect(o.expirationTime).toBeTruthy();
  });

  it("多笔同价订单 → 应付金额自动错开，绝不重复", async () => {
    const p = seedManual(500, "ex2");
    const a = await createExchangeOrder({ slug: p.slug, email: "a@test.dev", quantity: 1 });
    const b = await createExchangeOrder({ slug: p.slug, email: "b@test.dev", quantity: 1 });
    const c = await createExchangeOrder({ slug: p.slug, email: "c@test.dev", quantity: 1 });

    const amounts = [a.payableAmount, b.payableAmount, c.payableAmount];
    expect(new Set(amounts).size).toBe(3); // 三笔各不相同
    // 且都是递增（后建的跳过已占用）
    expect(amounts).toEqual(["5.00", "5.01", "5.02"]);
  });

  it("不同数量 → 金额反映总价，且各自唯一", async () => {
    const p = seedManual(500, "ex3");
    const one = await createExchangeOrder({ slug: p.slug, email: "x@test.dev", quantity: 1 }); // 5.00
    const three = await createExchangeOrder({ slug: p.slug, email: "y@test.dev", quantity: 3 }); // 15.00
    expect(one.payableAmount).toBe("5.00");
    expect(three.payableAmount).toBe("15.00");
  });

  it("汇率换算生效：rate=7.25 时 CNY 订单应付折算为 USDT", async () => {
    // 换成 CNY 商品 + rate 7.25
    saveExchangeChannel("binance", {
      enabled: true,
      accountId: "12345",
      asset: "USDT",
      rate: "7.25",
      apiKey: "k",
      apiSecret: "s",
    });
    const slug = `excny-${Date.now()}`;
    db.insert(products)
      .values({
        name: "CNY 商品",
        slug,
        description: "d",
        priceCents: 725, // 7.25 CNY
        currency: "CNY",
        deliveryType: "manual",
        stockLimit: 100,
        status: "on",
      })
      .run();

    const r = await createExchangeOrder({ slug, email: "cny@test.dev", quantity: 1 });
    // 7.25 CNY / 7.25 = 1.00 USDT
    expect(r.payableAmount).toBe("1.00");
  });

  it("未启用渠道时拒绝创建", async () => {
    saveExchangeChannel("binance", {
      enabled: false,
      accountId: "12345",
      asset: "USDT",
      rate: "1",
      apiKey: "k",
      apiSecret: "s",
    });
    const p = seedManual(500, "ex4");
    await expect(
      createExchangeOrder({ slug: p.slug, email: "x@test.dev", quantity: 1 })
    ).rejects.toThrow(/未启用|未配置|渠道/);
  });

  it("商品下架/不存在时拒绝", async () => {
    await expect(
      createExchangeOrder({ slug: "nonexistent-slug-xyz", email: "x@test.dev", quantity: 1 })
    ).rejects.toThrow(/商品/);
  });
});