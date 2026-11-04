import { describe, expect, it } from "vitest";
import {
  hmacHex,
  litepaySign,
  litepaySignString,
  md5Hex,
  parseJsonObject,
  safeEqualHex,
} from "@/lib/litepay-sign";

describe("LitePay 签名（与网关 internal/sign 对齐）", () => {
  it("ASCII 升序、跳空值、末尾拼令牌、MD5 小写", () => {
    const params = {
      order_id: "TEST001",
      amount: 10,
      fiat: "USD",
      currencies: "USDT,USDC",
      reselect: true,
      notify_url: "https://shop.example.com/api/webhooks/litepay",
      redirect_url: "",
      signature: "ignored",
    };
    const str = litepaySignString(params, "tok");
    expect(str).toBe(
      "amount=10&currencies=USDT,USDC&fiat=USD&notify_url=https://shop.example.com/api/webhooks/litepay&order_id=TEST001&reselect=truetok"
    );
    expect(litepaySign(params, "tok")).toBe(md5Hex(str));
    expect(litepaySign(params, "tok")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("数值保持 JSON 十进制形态（不接受指数形式）", () => {
    expect(litepaySignString({ a: 42 }, "t")).toBe("a=42t");
    expect(litepaySignString({ a: 42.5 }, "t")).toBe("a=42.5t");
    expect(litepaySignString({ a: 0.1 }, "t")).toBe("a=0.1t");
    expect(litepaySignString({ a: false }, "t")).toBe("a=falset");
    // 网关照 JSON 原文验签：指数形式的金额永远对不上
    expect(litepaySignString({ a: 1e7 }, "t")).toBe("a=10000000t");
  });

  it("签名篡改/换令牌可检出", () => {
    const params = { order_id: "A", amount: 1 };
    const sig = litepaySign(params, "tok");
    expect(safeEqualHex(sig, litepaySign(params, "tok"))).toBe(true);
    expect(safeEqualHex(sig, litepaySign({ ...params, amount: 2 }, "tok"))).toBe(false);
    expect(safeEqualHex(sig, litepaySign(params, "other"))).toBe(false);
  });

  it("parseJsonObject 拒绝非对象", () => {
    expect(parseJsonObject("null").ok).toBe(false);
    expect(parseJsonObject("[]").ok).toBe(false);
    expect(parseJsonObject("123").ok).toBe(false);
    expect(parseJsonObject("not json").ok).toBe(false);
    expect(parseJsonObject('{"a":1}')).toMatchObject({ ok: true });
  });

  it("hmacHex 稳定", () => {
    expect(hmacHex("k", "data")).toBe(hmacHex("k", "data"));
    expect(hmacHex("k", "data")).not.toBe(hmacHex("k2", "data"));
  });
});
