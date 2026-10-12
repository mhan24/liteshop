import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { epusdtSign, epusdtSignString, epusdtVerify, goFormatValue, parseJsonObject } from "./signature";

// bepusdt 官方文档（docs/api/api.md）签名示例参数与 Token
const DOC_TOKEN = "epusdt_password_xasddawqe";
const DOC_PARAMS = {
  amount: 42,
  notify_url: "http://example.com/notify",
  order_id: "20220201030210321",
  redirect_url: "http://example.com/redirect",
};

describe("epusdtSign（与网关 EpusdtSign 源码对齐）", () => {
  it("文档示例：拼接串与算法逐字对齐", () => {
    // 文档明确给出拼接串：MD5(amount=42&notify_url=...&order_id=...&redirect_url=...+token)
    const expectedConcat =
      "amount=42&notify_url=http://example.com/notify&order_id=20220201030210321&redirect_url=http://example.com/redirect" +
      DOC_TOKEN;
    const expected = createHash("md5").update(expectedConcat, "utf8").digest("hex");
    expect(epusdtSignString(DOC_PARAMS, DOC_TOKEN)).toBe(expectedConcat);
    expect(epusdtSign(DOC_PARAMS, DOC_TOKEN)).toBe(expected);
    expect(epusdtSign(DOC_PARAMS, DOC_TOKEN)).toBe(expected.toLowerCase());
  });

  it("键按 ASCII 字典序排序", () => {
    const s = epusdtSignString({ b: "2", a: "1", C: "3" }, "tok");
    expect(s).toBe("C=3&a=1&b=2tok");
  });

  it("空值与 signature 不参与", () => {
    const s = epusdtSignString(
      { a: "1", empty: "", nil: null, undef: undefined, signature: "fakesig" },
      "tok"
    );
    expect(s).toBe("a=1tok");
  });

  it("Go %v 等价格式化：bool 小写、float 最短表示", () => {
    expect(goFormatValue(true)).toBe("true");
    expect(goFormatValue(false)).toBe("false");
    expect(goFormatValue(42)).toBe("42"); // Go %v(42.0) = "42"
    expect(goFormatValue(42.5)).toBe("42.5");
    expect(goFormatValue(1.5e21)).toBe("1.5e+21"); // Go %v 大数科学计数法
  });

  it("验签通过与篡改拒绝", () => {
    const body = { ...DOC_PARAMS, signature: epusdtSign(DOC_PARAMS, DOC_TOKEN) };
    expect(epusdtVerify(body, DOC_TOKEN)).toBe(true);
    expect(epusdtVerify({ ...body, amount: 1 }, DOC_TOKEN)).toBe(false);
    expect(epusdtVerify({ ...body, amount: 1 }, DOC_TOKEN)).toBe(false);
    expect(epusdtVerify({ ...body }, "wrong-token")).toBe(false);
    expect(epusdtVerify({ no_sig: 1 }, DOC_TOKEN)).toBe(false);
  });
});

describe("parseJsonObject：畸形回调不得抛异常", () => {
  it("拒绝 JSON null / 数组 / 标量（JSON.parse 不会抛错但结果非对象）", () => {
    for (const raw of ["null", "[]", "0", "false", '"str"', "123"]) {
      const r = parseJsonObject(raw);
      expect(r.ok).toBe(false);
    }
  });

  it("拒绝非法 JSON", () => {
    for (const raw of ["", "not json", "{", "undefined"]) {
      expect(parseJsonObject(raw).ok).toBe(false);
    }
  });

  it("接受普通对象", () => {
    const r = parseJsonObject('{"order_id":"LS1","status":2}');
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value["order_id"]).toBe("LS1");
  });

  it("回归：null body 曾导致 epusdtVerify 抛 TypeError", () => {
    // 直接构造 null 会触发 "Cannot read properties of null (reading 'signature')"
    const parsed = parseJsonObject("null");
    expect(parsed.ok).toBe(false);
    // 确认拦截后不会走到 epusdtVerify
    expect(() => { if (parsed.ok) epusdtVerify(parsed.value, "t"); }).not.toThrow();
  });
});
