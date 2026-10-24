import { describe, expect, it } from "vitest";
import { epusdtSign, epusdtSignString, hmacHex, md5Hex, parseJsonObject, safeEqualHex } from "@/lib/epusdt";

describe("BEpusdt 签名（pay.9527.tr 实测对齐）", () => {
  it("ASCII 升序、跳空值、末尾拼 token、MD5 小写", () => {
    const params = {
      order_id: "TEST001",
      amount: 10,
      fiat: "USD",
      currencies: "USDT,USDC",
      reselect: true,
      notify_url: "https://shop.example.com/api/webhooks/pay/litepay",
      redirect_url: "",
      signature: "ignored",
    };
    const str = epusdtSignString(params, "tok");
    expect(str).toBe(
      "amount=10&currencies=USDT,USDC&fiat=USD&notify_url=https://shop.example.com/api/webhooks/pay/litepay&order_id=TEST001&reselect=truetok"
    );
    expect(epusdtSign(params, "tok")).toBe(md5Hex(str));
    expect(epusdtSign(params, "tok")).toMatch(/^[0-9a-f]{32}$/);
  });

  it("数字格式化与 Go %v 一致", () => {
    expect(epusdtSignString({ a: 42 }, "t")).toBe("a=42t");
    expect(epusdtSignString({ a: 42.5 }, "t")).toBe("a=42.5t");
    expect(epusdtSignString({ a: false }, "t")).toBe("a=falset");
  });

  it("签名篡改/换 token 检测", () => {
    const params = { order_id: "A", amount: 1 };
    const sig = epusdtSign(params, "tok");
    expect(safeEqualHex(sig, epusdtSign(params, "tok"))).toBe(true);
    expect(safeEqualHex(sig, epusdtSign({ ...params, amount: 2 }, "tok"))).toBe(false);
    expect(safeEqualHex(sig, epusdtSign(params, "other"))).toBe(false);
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
