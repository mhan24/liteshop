import { describe, expect, it } from "vitest";
import { formatMinor, formatMoney, minorToNumber, toMinorUnits } from "@/lib/money";

describe("money：金额换算（禁浮点误差）", () => {
  it("两位小数币种：字符串精确到分", () => {
    expect(toMinorUnits("12.34", "USD")).toBe(1234);
    expect(toMinorUnits("0.5", "USD")).toBe(50);
    expect(toMinorUnits("0.05", "USD")).toBe(5);
    expect(toMinorUnits(9.9, "USD")).toBe(990);
    expect(toMinorUnits("1000", "CNY")).toBe(100000);
  });

  it("零小数币种（JPY）：不接受小数", () => {
    expect(toMinorUnits("1500", "JPY")).toBe(1500);
    expect(() => toMinorUnits("1500.5", "JPY")).toThrow();
  });

  it("拒绝非法与超精度输入", () => {
    expect(() => toMinorUnits("12.345", "USD")).toThrow();
    expect(() => toMinorUnits("abc", "USD")).toThrow();
    expect(() => toMinorUnits("", "USD")).toThrow();
  });

  it("负数金额", () => {
    expect(toMinorUnits("-1.5", "USD")).toBe(-150);
  });

  it("格式化输出", () => {
    expect(formatMinor(1234, "USD")).toBe("12.34");
    expect(formatMoney(1234, "USD")).toBe("$12.34");
    expect(formatMoney(1500, "JPY")).toBe("¥1500");
    expect(minorToNumber(990, "USD")).toBe(9.9);
    expect(minorToNumber(1500, "JPY")).toBe(1500);
  });
});
