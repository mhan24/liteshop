import { describe, expect, it } from "vitest";
import { generateOrderNo, isValidOrderNo } from "./order-no";

describe("order_no（LS + YYYYMMDD + 8 随机 + 2 校验和，非自增）", () => {
  it("格式合法且校验和自洽", () => {
    const no = generateOrderNo(new Date("2026-10-11T08:00:00"));
    expect(no).toMatch(/^LS20261011[2-9A-HJKMNP-Z]{8}[2-9A-HJKMNP-Z]{2}$/);
    expect(isValidOrderNo(no)).toBe(true);
  });

  it("随机性：批量生成不重复", () => {
    const set = new Set(Array.from({ length: 500 }, () => generateOrderNo()));
    expect(set.size).toBe(500);
  });

  it("篡改校验和不通过", () => {
    const no = generateOrderNo();
    const body = no.slice(0, -2);
    // 翻转校验和最后一位
    const bad = body + (no.endsWith("Z") ? "X" : "Z");
    expect(isValidOrderNo(bad)).toBe(false);
  });

  it("拒绝自增样式与垃圾输入", () => {
    expect(isValidOrderNo("10001")).toBe(false);
    expect(isValidOrderNo("")).toBe(false);
    expect(isValidOrderNo("LS20261011AAAAAAAAAA")).toBe(false);
    expect(isValidOrderNo("LS20261011IIIIIIIIOO")).toBe(false); // 易混淆字符不在字母表
  });
});
