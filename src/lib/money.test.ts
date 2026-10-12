import { describe, expect, it } from "vitest";
import { currencySymbol, formatCents, formatMoney, MoneyParseError, normalizeAmountString, toCents, toMinorUnits, minorUnitsToNumber, isZeroDecimalCurrency } from "./money";

describe("toCents（整数分转换，禁浮点）", () => {
  it("整数字符串", () => {
    expect(toCents("42")).toBe(4200n);
    expect(toCents("100")).toBe(10000n);
    expect(toCents("0")).toBe(0n);
  });

  it("两位小数", () => {
    expect(toCents("42.50")).toBe(4250n);
    expect(toCents("0.07")).toBe(7n);
    expect(toCents("41.07")).toBe(4107n);
  });

  it("一位小数补零", () => {
    expect(toCents("42.5")).toBe(4250n);
    expect(toCents("42.05")).toBe(4205n);
  });

  it("number 输入与 Go %v 一致（最短表示）", () => {
    expect(toCents(42)).toBe(4200n);
    expect(toCents(42.5)).toBe(4250n);
    expect(toCents(41.07)).toBe(4107n);
  });

  it("第三位四舍五入到分", () => {
    expect(toCents("0.005")).toBe(1n);
    expect(toCents("0.004")).toBe(0n);
    expect(toCents("41.999")).toBe(4200n);
    expect(toCents("41.994")).toBe(4199n);
  });

  it("符号", () => {
    expect(toCents("-12.34")).toBe(-1234n);
  });

  it("非法输入拒绝", () => {
    expect(() => toCents("abc")).toThrow(MoneyParseError);
    expect(() => toCents("12.34.56")).toThrow(MoneyParseError);
    expect(() => toCents("")).toThrow(MoneyParseError);
    expect(() => toCents(Number.NaN)).toThrow(MoneyParseError);
    expect(() => toCents(Number.POSITIVE_INFINITY)).toThrow(MoneyParseError);
  });
});

describe("formatCents", () => {
  it("分转两位小数字符串", () => {
    expect(formatCents(4250n)).toBe("42.50");
    expect(formatCents(7n)).toBe("0.07");
    expect(formatCents(0n)).toBe("0.00");
    expect(formatCents(123456n)).toBe("1234.56");
    expect(formatCents(-1234n)).toBe("-12.34");
  });
});

describe("normalizeAmountString（actual_amount 对账）", () => {
  it("尾零归一", () => {
    expect(normalizeAmountString("12.3400")).toBe("12.34");
    expect(normalizeAmountString("12.00")).toBe("12");
    expect(normalizeAmountString("12")).toBe("12");
    expect(normalizeAmountString("0.500000")).toBe("0.5");
    expect(normalizeAmountString(" 42.5 ")).toBe("42.5");
  });
});

describe("formatMoney / currencySymbol（全站统一展示）", () => {
  it("常见币种符号", () => {
    expect(formatMoney(990n, "USD")).toBe("$9.90");
    expect(formatMoney(4250n, "CNY")).toBe("¥42.50");
    expect(formatMoney(1234n, "EUR")).toBe("€12.34");
    expect(formatMoney(7n, "GBP")).toBe("£0.07");
    expect(currencySymbol("JPY")).toBe("¥");
  });

  it("未知币种回退代码前缀", () => {
    expect(formatMoney(990n, "AUD")).toBe("AUD 9.90");
    expect(currencySymbol("AUD")).toBe("");
  });

  it("大小写不敏感", () => {
    expect(formatMoney(990n, "usd")).toBe("$9.90");
  });
});

describe("零小数币种（JPY）", () => {
  it("JPY 展示不带小数", () => {
    expect(formatMoney(1500n, "JPY")).toBe("¥1500");
    expect(formatMoney(0n, "JPY")).toBe("¥0");
    // 其它币种仍保留两位
    expect(formatMoney(1500n, "USD")).toBe("$15.00");
  });

  it("JPY 价格按整数日元解析（不做 /100）", () => {
    expect(toMinorUnits("1500", "JPY")).toBe(1500n);
    expect(toMinorUnits(900, "JPY")).toBe(900n);
    // 两位小数币种照常
    expect(toMinorUnits("9.90", "USD")).toBe(990n);
    expect(toMinorUnits("1500", "USD")).toBe(150000n);
  });

  it("JPY 拒绝小数金额（日元没有分）", () => {
    expect(() => toMinorUnits("15.5", "JPY")).toThrow();
    expect(() => toMinorUnits("15.05", "JPY")).toThrow();
    // .00 允许（等价整数）
    expect(toMinorUnits("15.00", "JPY")).toBe(15n);
  });

  it("传给网关的数值按币种换算", () => {
    expect(minorUnitsToNumber(1500n, "JPY")).toBe(1500);
    expect(minorUnitsToNumber(1500n, "USD")).toBe(15);
  });
});

describe("按币种区分最小单位（回归：跨币种直接相加）", () => {
  it("isZeroDecimalCurrency 判定正确", () => {
    expect(isZeroDecimalCurrency("JPY")).toBe(true);
    expect(isZeroDecimalCurrency("jpy")).toBe(true);
    expect(isZeroDecimalCurrency("USD")).toBe(false);
    expect(isZeroDecimalCurrency("CNY")).toBe(false);
  });
});
