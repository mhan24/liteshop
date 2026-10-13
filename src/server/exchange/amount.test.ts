import { describe, expect, it } from "vitest";
import {
  allocateUniquePayable,
  fiatToPayableMinor,
  formatPayable,
  parsePayable,
  parseRate,
} from "./amount";

/**
 * 金额计算是这一层最危险的部分：错了就是错发/错收钱。
 * 所有断言都用整数最小单位，明确「单位是什么」，避免浮点误判。
 *
 * 约定：payable 的最小单位 = 0.01 USDT（1 → 0.01）
 */

describe("parsePayable：解析到账金额", () => {
  it("正常金额", () => {
    expect(parsePayable("5.03")).toBe(503n);
    expect(parsePayable("5")).toBe(500n);
    expect(parsePayable("0.01")).toBe(1n);
    expect(parsePayable("1234.56")).toBe(123456n);
  });

  it("尾部多余 0 视为等价", () => {
    expect(parsePayable("5.030000")).toBe(503n);
    expect(parsePayable("5.030000000")).toBe(503n);
  });

  it("超出精度且含非零位 → 不匹配（不静默截断）", () => {
    // 这是关键：5.689999 不能被当成 5.69，否则会把不同金额误认为同一笔
    expect(parsePayable("5.689999")).toBeNull();
    expect(parsePayable("5.031")).toBeNull();
  });

  it("非法输入返回 null", () => {
    for (const bad of ["", "  ", "abc", "-5.03", "5.03.1", "1e2", "+5", "$5"]) {
      expect(parsePayable(bad), bad).toBeNull();
    }
  });

  it("round-trip 稳定", () => {
    for (const v of ["0.01", "5.03", "99.99", "1000"]) {
      expect(formatPayable(parsePayable(v)!)).toBe(
        v.includes(".") ? v : `${v}.00`
      );
    }
  });
});

describe("formatPayable", () => {
  it("固定两位小数", () => {
    expect(formatPayable(503n)).toBe("5.03");
    expect(formatPayable(500n)).toBe("5.00");
    expect(formatPayable(1n)).toBe("0.01");
    expect(formatPayable(0n)).toBe("0.00");
  });
});

describe("parseRate：汇率解析", () => {
  it("按 1e8 缩放", () => {
    expect(parseRate("1")).toBe(100000000n);
    expect(parseRate("7.25")).toBe(725000000n);
    expect(parseRate("7.25000000")).toBe(725000000n);
  });

  it("拒绝 0、负数与非数字", () => {
    for (const bad of ["0", "0.00", "-7", "abc", "", "  ", "7,25"]) {
      expect(parseRate(bad), bad).toBeNull();
    }
  });

  it("拒绝超过 8 位精度的汇率", () => {
    expect(parseRate("1.123456789")).toBeNull();
  });
});

describe("fiatToPayableMinor：汇率换算（向上取整）", () => {
  it("CNY → USDT：rate 表示 1 USDT 值多少 CNY", () => {
    // 7.25 CNY = 1 USDT → 7.25 CNY 的订单应付 1.00 USDT
    expect(fiatToPayableMinor(725n, "CNY", "7.25")).toBe(100n);
    // 10.00 CNY → 10/7.25 = 1.3793 → 向上取整 1.38
    expect(fiatToPayableMinor(1000n, "CNY", "7.25")).toBe(138n);
  });

  it("USD → USDT：rate=1 时 1:1", () => {
    expect(fiatToPayableMinor(500n, "USD", "1")).toBe(500n);
    expect(fiatToPayableMinor(123n, "USD", "1")).toBe(123n);
  });

  it("零小数币种（JPY）不按 2 位缩放", () => {
    // JPY 最小单位就是「元」：1000 JPY / 100 (1 USDT=100 JPY) = 10 USDT = 1000（0.01 单位）
    expect(fiatToPayableMinor(1000n, "JPY", "100")).toBe(1000n);
  });

  it("永不因舍入少付：向上取整", () => {
    // 1 CNY / 7.25 = 0.13793 → 0.14（不能是 0.13）
    const got = fiatToPayableMinor(100n, "CNY", "7.25");
    expect(got).toBe(14n);
    // 反向验证：应付值换回法币必须 ≥ 原价
    const rate = 725000000n;
    const back = (BigInt(got) * rate) / (100n * 100000000n);
    expect(back * 100n).toBeGreaterThanOrEqual(100n);
  });

  it("拒绝 0 或负订单额", () => {
    expect(() => fiatToPayableMinor(0n, "USD", "1")).toThrow(/正/);
    expect(() => fiatToPayableMinor(-100n, "USD", "1")).toThrow(/正/);
  });

  it("拒绝非法汇率", () => {
    expect(() => fiatToPayableMinor(100n, "USD", "0")).toThrow(/汇率/);
    expect(() => fiatToPayableMinor(100n, "USD", "abc")).toThrow(/汇率/);
  });

  it("无浮点误差：循环 200 次验证稳定性", () => {
    // 浮点实现在某些输入会给出 137 而非 138
    for (let i = 1; i <= 200; i += 1) {
      const v = fiatToPayableMinor(BigInt(i), "CNY", "7.25");
      const expected = BigInt(Math.ceil((i / 100 / 7.25) * 100));
      expect(v, `i=${i}`).toBe(expected);
    }
  });
});

describe("allocateUniquePayable：唯一金额分配", () => {
  it("无冲突时直接返回基准值", () => {
    expect(allocateUniquePayable(138n, new Set())).toBe(138n);
  });

  it("冲突则递增到唯一值", () => {
    const used = new Set(["1.38", "1.39"]);
    expect(allocateUniquePayable(138n, used)).toBe(140n);
  });

  it("连续占用时继续递增", () => {
    const used = new Set(["1.38", "1.39", "1.40", "1.41", "1.42"]);
    expect(allocateUniquePayable(138n, used)).toBe(143n);
  });

  it("超过上限返回 null（拒绝建单，而不是制造歧义）", () => {
    const used = new Set(Array.from({ length: 100 }, (_, i) => formatPayable(138n + BigInt(i))));
    expect(allocateUniquePayable(138n, used, 10)).toBeNull();
  });

  it("允许跨过 1.00 等整数位继续递增", () => {
    const used = new Set(["0.99"]);
    expect(allocateUniquePayable(99n, used)).toBe(100n);
  });
});