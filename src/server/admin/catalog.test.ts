import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { listOrdersForAdmin, getDashboardStats, validateProductInput } from "./catalog";

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

describe("营收口径：以 paidAt 判定，而非 status", () => {
  it("已付款后关闭的订单仍计入营收（回归：关闭后营收凭空消失）", () => {
    const paid = new Date();
    seedOrder("LSE111111111111EE", "e@test.dev", "closed", paid, 500);
    const stats = getDashboardStats(0);
    // 该单虽为 closed，但确实收过钱，必须计入
    expect(stats.totalRevenueCents).toBeGreaterThanOrEqual(500);
  });

  it("从未付款的 closed/pending 订单不计入营收", () => {
    const before = getDashboardStats(0).totalRevenueCents;
    seedOrder("LSF222222222222FF", "f@test.dev", "closed", null, 999);
    seedOrder("LSG333333333333GG", "g@test.dev", "pending", null, 999);
    expect(getDashboardStats(0).totalRevenueCents).toBe(before);
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
