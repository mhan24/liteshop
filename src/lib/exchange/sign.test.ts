import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { binanceSign, buildBinanceQuery, buildOkxRequestPath, okxSign } from "./sign";

/**
 * 签名是交易所接入最容易出错、也最难在本地发现的一环
 * （错了只会表现为 401/签名无效）。因此用**独立计算**交叉验证公式，
 * 而不是只断言"输出非空"。
 */

describe("币安签名", () => {
  it("为 HMAC-SHA256 hex，且与独立计算一致", () => {
    const sig = binanceSign("my-secret", "a=1&b=2");
    expect(sig).toMatch(/^[0-9a-f]{64}$/);
    expect(sig).toBe(
      createHmac("sha256", "my-secret").update("a=1&b=2", "utf8").digest("hex")
    );
  });

  it("不同密钥/原文产生不同签名", () => {
    expect(binanceSign("s1", "a=1")).not.toBe(binanceSign("s2", "a=1"));
    expect(binanceSign("s1", "a=1")).not.toBe(binanceSign("s1", "a=2"));
  });

  it("query 串按键升序、值做 URL 编码", () => {
    expect(buildBinanceQuery({ b: 2, a: 1 })).toBe("a=1&b=2");
    expect(buildBinanceQuery({ symbol: "A B/C" })).toBe("symbol=A%20B%2FC");
    expect(buildBinanceQuery({ limit: 100, timestamp: 1700000000000 })).toBe(
      "limit=100&timestamp=1700000000000"
    );
  });

  it("排序保证「构造签名」与「发送」两处原文完全一致", () => {
    // 同样的键、不同插入顺序 → 同样的 query 与签名
    const a = buildBinanceQuery({ timestamp: 1, recvWindow: 5000, limit: 100 });
    const b = buildBinanceQuery({ limit: 100, timestamp: 1, recvWindow: 5000 });
    expect(a).toBe(b);
    expect(binanceSign("s", a)).toBe(binanceSign("s", b));
  });
});

describe("欧易签名", () => {
  it("为 HMAC-SHA256 base64，且原文为 timestamp+method+requestPath", () => {
    const ts = "2026-10-13T00:00:00.000Z";
    const path = "/api/v5/asset/bills?ccy=USDT&limit=100";
    const sig = okxSign("my-secret", ts, "GET", path);
    expect(sig).toBe(
      createHmac("sha256", "my-secret")
        .update(`${ts}GET${path}`, "utf8")
        .digest("base64")
    );
    // base64 特征
    expect(sig).toMatch(/^[A-Za-z0-9+/]+=*$/);
  });

  it("method 大小写不影响结果（统一转大写）", () => {
    const ts = "t";
    expect(okxSign("s", ts, "get", "/p")).toBe(okxSign("s", ts, "GET", "/p"));
  });

  it("requestPath 含 query（拼错会直接签名无效）", () => {
    expect(buildOkxRequestPath("/api/v5/asset/bills", { ccy: "USDT", limit: 100 })).toBe(
      "/api/v5/asset/bills?ccy=USDT&limit=100"
    );
    expect(buildOkxRequestPath("/api/v5/account/config", {})).toBe("/api/v5/account/config");
  });

  it("与币安签名格式不同（不可混用）", () => {
    const bin = binanceSign("s", "a=1");
    const okx = okxSign("s", "", "GET", "a=1");
    expect(bin).not.toBe(okx);
  });
});
