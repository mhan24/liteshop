import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders } from "@/db/schema";
import {
  listOrdersForAdmin,
  getDashboardStats,
  validateProductInput,
  startOfTodayBeijing,
} from "./catalog";

/** 后台目录服务：搜索转义、营收口径、商品校验 */

function seedOrder(orderNo: string, email: string, status = "pending", paidAt: Date | null = null, totalCents = 100) {
  db.insert(orders)
    .values({
      orderNo,
      productName: "T",
      unitPriceCents: totalCents,
      currency: "USD",
      quantity: 1,
      totalCents,
      email,
      status,
      paidAt,
    })
    .run();
}

describe("后台订单搜索：LIKE 元字符必须按字面量处理", () => {
  it("搜索 % 不返回全部订单（回归：通配符注入）", () => {
    seedOrder("LSA000000000000AA", "a@test.dev");
    seedOrder("LSB000000000000BB", "b@test.dev");

    // "%" 若不转义会匹配所有订单
    const byPercent = listOrdersForAdmin({ q: "%" });
    expect(byPercent).toHaveLength(0);
  });

  it("搜索 _ 不返回全部订单", () => {
    seedOrder("LSC000000000000CC", "c@test.dev");
    const byUnderscore = listOrdersForAdmin({ q: "_" });
    expect(byUnderscore).toHaveLength(0);
  });

  it("正常关键词仍可搜索（订单号与邮箱，且大小写不敏感）", () => {
    seedOrder("LSD12345678901DD", "FindMe@Test.dev");
    expect(listOrdersForAdmin({ q: "LSD1234" }).length).toBeGreaterThan(0);
    expect(listOrdersForAdmin({ q: "findme@test" }).length).toBeGreaterThan(0);
  });
});

describe("营收口径：以 paidAt 判定、按币种分组", () => {
  const sumOf = (rows: { amount: number }[]) => rows.reduce((s, r) => s + r.amount, 0);

  it("已付款后关闭的订单仍计入营收（回归：关闭后营收凭空消失）", () => {
    const paid = new Date();
    seedOrder("LSE111111111111EE", "e@test.dev", "closed", paid, 500);
    const stats = getDashboardStats(0);
    expect(sumOf(stats.totalRevenue)).toBeGreaterThanOrEqual(500);
  });

  it("从未付款的 closed/pending 订单不计入营收", () => {
    const before = sumOf(getDashboardStats(0).totalRevenue);
    seedOrder("LSF222222222222FF", "f@test.dev", "closed", null, 999);
    seedOrder("LSG333333333333GG", "g@test.dev", "pending", null, 999);
    expect(sumOf(getDashboardStats(0).totalRevenue)).toBe(before);
  });

  it("不同币种分别成组，绝不跨币种相加（回归：USD 与 CNY 直接求和）", () => {
    const paid = new Date();
    const before = getDashboardStats(0).totalRevenue;
    const usdBefore = before.find((r) => r.currency === "USD")?.amount ?? 0;
    const cnyBefore = before.find((r) => r.currency === "CNY")?.amount ?? 0;
    db.insert(orders).values({
      orderNo: "LSUSD00000000001", productName: "T", unitPriceCents: 50, currency: "USD",
      quantity: 1, totalCents: 50, email: "usd@test.dev", status: "completed", paidAt: paid,
    }).run();
    db.insert(orders).values({
      orderNo: "LSCNY00000000001", productName: "T", unitPriceCents: 500, currency: "CNY",
      quantity: 1, totalCents: 500, email: "cny@test.dev", status: "completed", paidAt: paid,
    }).run();

    const rows = getDashboardStats(0).totalRevenue;
    const usd = rows.find((r) => r.currency === "USD");
    const cny = rows.find((r) => r.currency === "CNY");
    expect(usd).toBeDefined();
    expect(cny).toBeDefined();
    // 关键：各币种只累加自己那一笔，USD 组不得混入 CNY 的 500
    expect(usd!.amount).toBe(usdBefore + 50);
    expect(cny!.amount).toBe(cnyBefore + 500);
    // 若跨币种相加，USD 组会被多算 500
    expect(usd!.amount).toBeLessThan(cny!.amount + usdBefore + 50);
  });
});

describe("今日边界采用北京时间", () => {
  it("startOfTodayBeijing 与 UTC 切分不同（容器默认 UTC 会错 8 小时）", () => {
    // 2026-10-12T03:00Z = 北京时间 11:00，北京当天起点应为 2026-10-11T16:00Z
    const at = new Date("2026-10-12T03:00:00.000Z");
    const start = startOfTodayBeijing(at);
    expect(start.toISOString()).toBe("2026-10-11T16:00:00.000Z");
  });

  it("北京时间刚过零点时归属新的一天", () => {
    // 2026-10-11T16:30Z = 北京 10-12 00:30，起点应为 10-11T16:00Z
    const at = new Date("2026-10-11T16:30:00.000Z");
    expect(startOfTodayBeijing(at).toISOString()).toBe("2026-10-11T16:00:00.000Z");
  });
});

describe("商品校验：非法价格不得抛异常", () => {
  const base = {
    name: "测试商品",
    slug: "",
    description: "",
    imageUrl: "",
    currency: "USD",
    deliveryType: "manual",
    stockLimit: 0,
    status: "on",
    sort: 0,
  };

  it("非法价格返回可读错误而非抛 MoneyParseError", () => {
    for (const price of ["abc", "", "1.2.3", "--5", "1e5"]) {
      const r = validateProductInput({ ...base, priceCentsText: price });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("价格");
    }
  });

  it("合法价格通过校验", () => {
    const r = validateProductInput({ ...base, priceCentsText: "9.90" });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.priceCents).toBe(990);
  });
});

describe("P1 回归：商品校验的币种与库存输入", () => {
  const base = {
    name: "回归商品",
    slug: "",
    description: "",
    imageUrl: "",
    deliveryType: "manual",
    status: "on",
    sort: 0,
  };

  it("币种被采纳（不再恒为站点默认）", () => {
    const r = validateProductInput({ ...base, priceCentsText: "10", currency: "EUR", stockLimit: -1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.currency).toBe("EUR");
  });

  it("非法币种被拒", () => {
    const r = validateProductInput({ ...base, priceCentsText: "10", currency: "XYZ", stockLimit: -1 });
    expect(r.ok).toBe(false);
  });

  it("JPY 商品按整数日元解析（不做 /100）", () => {
    const r = validateProductInput({ ...base, priceCentsText: "1500", currency: "JPY", stockLimit: -1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.priceCents).toBe(1500);
  });

  it("JPY 商品拒绝小数价格", () => {
    const r = validateProductInput({ ...base, priceCentsText: "15.5", currency: "JPY", stockLimit: -1 });
    expect(r.ok).toBe(false);
  });

  it("库存 -1 表示不限并原样保留", () => {
    const r = validateProductInput({ ...base, priceCentsText: "10", currency: "USD", stockLimit: -1 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.stockLimit).toBe(-1);
  });

  it("库存 0 表示售罄并原样保留（不得被当成不限）", () => {
    const r = validateProductInput({ ...base, priceCentsText: "10", currency: "USD", stockLimit: 0 });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.data.stockLimit).toBe(0);
  });
});
