import { describe, expect, it } from "vitest";
import {
  STOCK_UNLIMITED,
  isUnlimitedStock,
  shouldChargeStock,
  visibleStock,
  isOnSaleByStock,
  normalizeStockLimit,
} from "./stock";

/** manual 库存语义：-1 = 不限；0 = 售罄；>0 = 剩余 */

describe("manual 库存哨兵语义", () => {
  it("-1 表示不限，且永不参与扣减", () => {
    expect(isUnlimitedStock(STOCK_UNLIMITED)).toBe(true);
    expect(shouldChargeStock(STOCK_UNLIMITED)).toBe(false);
    expect(visibleStock(STOCK_UNLIMITED)).toBeNull();
    expect(isOnSaleByStock(STOCK_UNLIMITED)).toBe(true);
  });

  it("0 明确表示售罄（不再被误解为不限）", () => {
    expect(isUnlimitedStock(0)).toBe(false);
    expect(shouldChargeStock(0)).toBe(true); // 关键：仍需校验，从而拒绝下单
    expect(visibleStock(0)).toBe(0);
    expect(isOnSaleByStock(0)).toBe(false);
  });

  it("正数表示剩余，可售且参与扣减", () => {
    expect(shouldChargeStock(5)).toBe(true);
    expect(visibleStock(5)).toBe(5);
    expect(isOnSaleByStock(5)).toBe(true);
  });

  it("normalizeStockLimit：空/非法/负数 → 不限", () => {
    expect(normalizeStockLimit("")).toBe(STOCK_UNLIMITED);
    expect(normalizeStockLimit(null)).toBe(STOCK_UNLIMITED);
    expect(normalizeStockLimit(undefined)).toBe(STOCK_UNLIMITED);
    expect(normalizeStockLimit(Number.NaN)).toBe(STOCK_UNLIMITED);
    expect(normalizeStockLimit(-5)).toBe(STOCK_UNLIMITED);
    expect(normalizeStockLimit("abc")).toBe(STOCK_UNLIMITED);
  });

  it("normalizeStockLimit：非负整数原样保留（含 0=售罄）", () => {
    expect(normalizeStockLimit(0)).toBe(0);
    expect(normalizeStockLimit("0")).toBe(0);
    expect(normalizeStockLimit(7)).toBe(7);
    expect(normalizeStockLimit("12")).toBe(12);
    expect(normalizeStockLimit(3.9)).toBe(3);
  });
});
