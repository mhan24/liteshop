import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { paymentConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { listCheckoutMethods, resolvePaymentProviderDefault } from "./index";
import { saveExchangeChannel } from "@/server/exchange/channel";

/**
 * 支付方式选择（复审后新增）。
 *
 * 历史缺陷：auto 直接取 payment_configs 返回顺序的第一个启用渠道，顺序无保证。
 * 启用交易所渠道后可能选中它 —— 而买家在前台既看不到转账指引、也付不了款，
 * 形成「下单成功却无法支付」的可用性事故。
 */

const prevDriver = process.env.PAYMENT_DRIVER;

beforeEach(() => {
  db.delete(paymentConfigs).where(eq(paymentConfigs.provider, "exchange:binance")).run();
  db.delete(paymentConfigs).where(eq(paymentConfigs.provider, "exchange:okx")).run();
});

afterEach(() => {
  process.env.PAYMENT_DRIVER = prevDriver;
});

function enableBepusdt(): void {
  // 用 upsert：共享测试库里可能已存在 bepusdt 配置
  db.insert(paymentConfigs)
    .values({
      provider: "bepusdt",
      enabled: true,
      configJson: { api_base: "https://pay.example.com", token: "t" },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: paymentConfigs.provider,
      set: { enabled: true, updatedAt: new Date() },
    })
    .run();
}

describe("auto 只选网关渠道", () => {
  it("交易所渠道先于 bepusdt 启用时，auto 仍选 bepusdt（确定性）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    // 故意先插交易所，模拟「返回顺序把交易所排在前面」的最坏情况
    saveExchangeChannel("binance", {
      enabled: true, accountId: "123", asset: "USDT", rate: "1",
      apiKey: "k", apiSecret: "s",
    });
    enableBepusdt();

    const chosen = resolvePaymentProviderDefault();
    expect(chosen.name).toBe("bepusdt");
  });

  it("多个网关渠道时按固定优先级选 bepusdt（结果可复现）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    enableBepusdt();
    for (let i = 0; i < 5; i++) expect(resolvePaymentProviderDefault().name).toBe("bepusdt");
  });

  it("只有交易所启用时，auto 报错而不是把买家丢给无指引的通道", () => {
    process.env.PAYMENT_DRIVER = "auto";
    // 关闭 bepusdt（共享测试库可能残留其它用例的配置）
    db.update(paymentConfigs)
      .set({ enabled: false })
      .where(eq(paymentConfigs.provider, "bepusdt"))
      .run();
    saveExchangeChannel("binance", {
      enabled: true, accountId: "123", asset: "USDT", rate: "1",
      apiKey: "k", apiSecret: "s",
    });
    // 测试环境 NODE_ENV=test → 回退 mock（生产则抛错）；
    // 关键是不返回交易所渠道
    const chosen = resolvePaymentProviderDefault();
    expect(chosen.name).toBe("mock");
    expect(chosen.name).not.toContain("exchange");

    // 生产环境必须抛错，而不是把买家丢给无指引的通道
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => resolvePaymentProviderDefault()).toThrow(/未启用任何支付渠道/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("前台可选支付方式", () => {
  it("未配置交易所时只暴露 bepusdt", () => {
    enableBepusdt();
    expect(listCheckoutMethods()).toEqual(["bepusdt"]);
  });

  it("交易所配置完整且启用时，两者都可选", () => {
    enableBepusdt();
    saveExchangeChannel("binance", {
      enabled: true, accountId: "123", asset: "USDT", rate: "1",
      apiKey: "k", apiSecret: "s",
    });
    expect(listCheckoutMethods()).toEqual(["bepusdt", "exchange"]);
  });

  it("交易所未启用时不暴露（避免选了付不了）", () => {
    enableBepusdt();
    saveExchangeChannel("binance", {
      enabled: false, accountId: "123", asset: "USDT", rate: "1",
      apiKey: "k", apiSecret: "s",
    });
    expect(listCheckoutMethods()).toEqual(["bepusdt"]);
  });
});
