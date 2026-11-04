import { describe, expect, it } from "vitest";
import { formatMinor, formatMoney, minorToNumber, toMinorUnits } from "@/lib/money";

describe("money：美元金额换算（禁浮点误差）", () => {
  it("字符串精确到分", () => {
    expect(toMinorUnits("12.34")).toBe(1234);
    expect(toMinorUnits("0.5")).toBe(50);
    expect(toMinorUnits("0.05")).toBe(5);
    expect(toMinorUnits(9.9)).toBe(990);
    expect(toMinorUnits("1000")).toBe(100000);
  });

  it("接受网关的 6 位小数尾零，但拒绝低于一分的金额", () => {
    expect(toMinorUnits("12.340000")).toBe(1234);
    expect(toMinorUnits("0.010000")).toBe(1);
    expect(() => toMinorUnits("12.345")).toThrow();
    expect(() => toMinorUnits("0.000001")).toThrow();
  });

  it("拒绝非法输入", () => {
    expect(() => toMinorUnits("abc")).toThrow();
    expect(() => toMinorUnits("")).toThrow();
    expect(() => toMinorUnits("-1.5")).toThrow();
  });

  it("格式化输出", () => {
    expect(formatMinor(1234)).toBe("12.34");
    expect(formatMoney(1234)).toBe("$12.34");
    expect(formatMoney(5)).toBe("$0.05");
    expect(minorToNumber(990)).toBe(9.9);
  });
});
