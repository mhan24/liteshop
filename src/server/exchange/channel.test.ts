import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/db";
import { paymentConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getExchangeChannelView, loadExchangeCredentials, saveExchangeChannel, findEnabledExchange } from "./channel";
import { decryptSecret } from "./credentials";

/**
 * 渠道配置：重点验证「密钥加密落库」与「明文永不外泄」。
 */

function rawConfig(provider: string): Record<string, unknown> {
  const row = db.select().from(paymentConfigs).where(eq(paymentConfigs.provider, provider)).get();
  return (row?.configJson ?? {}) as Record<string, unknown>;
}

beforeEach(() => {
  db.delete(paymentConfigs).where(eq(paymentConfigs.provider, "exchange:binance")).run();
  db.delete(paymentConfigs).where(eq(paymentConfigs.provider, "exchange:okx")).run();
});

describe("交易所渠道配置", () => {
  it("保存后可读回视图，但不暴露密钥", () => {
    const res = saveExchangeChannel("binance", {
      enabled: true,
      accountId: "12345",
      asset: "USDT",
      rate: "7.25",
      apiKey: "PUBLIC-KEY",
      apiSecret: "SUPER-SECRET",
    });
    expect(res.ok).toBe(true);

    const view = getExchangeChannelView("binance");
    expect(view.accountId).toBe("12345");
    expect(view.rate).toBe("7.25");
    expect(view.asset).toBe("USDT");
    expect(view.enabled).toBe(true);
    expect(view.hasApiKey).toBe(true);
    expect(view.hasSecret).toBe(true);
    // 视图里绝不能出现明文密钥
    expect(JSON.stringify(view)).not.toContain("SUPER-SECRET");
  });

  it("落库的是密文，且可用 AUTH_SECRET 解回原文", () => {
    saveExchangeChannel("binance", {
      enabled: true, accountId: "1", asset: "USDT", rate: "1",
      apiKey: "k", apiSecret: "MY-SECRET-VALUE",
    });
    const raw = rawConfig("exchange:binance");
    expect(JSON.stringify(raw)).not.toContain("MY-SECRET-VALUE");
    const enc = String(raw["apiSecretEnc"]);
    expect(enc.startsWith("enc:v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe("MY-SECRET-VALUE");
  });

  it("运行凭据可解密取回", () => {
    saveExchangeChannel("binance", {
      enabled: true, accountId: "1", asset: "USDT", rate: "1",
      apiKey: "k", apiSecret: "SEC",
    });
    const loaded = loadExchangeCredentials("binance");
    expect(loaded).not.toBeNull();
    expect(loaded!.cred.apiSecret).toBe("SEC");
    expect(loaded!.cred.accountId).toBe("1");
    expect(loaded!.asset).toBe("USDT");
  });

  it("欧易凭据包含 passphrase，且必填", () => {
    const missing = saveExchangeChannel("okx", {
      enabled: true, accountId: "1", asset: "USDT", rate: "1", apiKey: "k", apiSecret: "s",
    });
    expect(missing.ok).toBe(false);
    expect(missing.error).toMatch(/passphrase/);

    const ok = saveExchangeChannel("okx", {
      enabled: true, accountId: "1", asset: "USDT", rate: "1",
      apiKey: "k", apiSecret: "s", passphrase: "PP",
    });
    expect(ok.ok).toBe(true);
    expect(loadExchangeCredentials("okx")!.cred.passphrase).toBe("PP");
  });

  it("密钥留空时保留原值（不回显导致误清空）", () => {
    saveExchangeChannel("binance", {
      enabled: true, accountId: "1", asset: "USDT", rate: "1", apiKey: "k", apiSecret: "FIRST",
    });
    // 第二次只改汇率，密钥留空
    saveExchangeChannel("binance", {
      enabled: true, accountId: "2", asset: "USDT", rate: "2",
      apiKey: "", apiSecret: "",
    });
    expect(loadExchangeCredentials("binance")!.cred.apiSecret).toBe("FIRST");
    expect(getExchangeChannelView("binance").accountId).toBe("2");
  });

  it("校验：账户标识必须纯数字", () => {
    const res = saveExchangeChannel("binance", {
      enabled: true, accountId: "abc", asset: "USDT", rate: "1", apiKey: "k", apiSecret: "s",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/纯数字/);
  });

  it("校验：汇率必须为正数", () => {
    const res = saveExchangeChannel("binance", {
      enabled: true, accountId: "1", asset: "USDT", rate: "0", apiKey: "k", apiSecret: "s",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/汇率/);
  });

  it("findEnabledExchange 只认配置完整且启用的渠道", () => {
    expect(findEnabledExchange()).toBeNull();
    saveExchangeChannel("binance", {
      enabled: false, accountId: "1", asset: "USDT", rate: "1", apiKey: "k", apiSecret: "s",
    });
    expect(findEnabledExchange()).toBeNull(); // 未启用
    saveExchangeChannel("binance", {
      enabled: true, accountId: "1", asset: "USDT", rate: "1", apiKey: "k", apiSecret: "s",
    });
    expect(findEnabledExchange()).toBe("binance");
  });
});