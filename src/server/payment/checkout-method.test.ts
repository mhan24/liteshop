import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { paymentConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { getCheckoutOptions, listCheckoutMethods, resolvePaymentProviderDefault } from "./index";

/**
 * 支付方式选择（复审后新增）。
 *
 * 历史缺陷：auto 直接取 payment_configs 返回顺序的第一个启用渠道，顺序无保证。
 * 启用交易所渠道后可能选中它 —— 而买家在前台既看不到转账指引、也付不了款，
 * 形成「下单成功却无法支付」的可用性事故。
 */

const prevDriver = process.env.PAYMENT_DRIVER;

beforeEach(() => {
  db.delete(paymentConfigs).where(eq(paymentConfigs.provider, "litepay")).run();
});

function enableLitepay(extra: Record<string, unknown> = {}): void {
  // 2026-10 起 litepay 渠道走 pay.9527.tr 的 BEpusdt 兼容接口，配置键与 bepusdt 一致。
  // 冲突时必须同步更新 configJson：共享测试库里可能残留旧行（无 sort_order 等）。
  db.insert(paymentConfigs)
    .values({
      provider: "litepay",
      enabled: true,
      configJson: { api_base: "https://pay.9527.tr", token: "t", ...extra },
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: paymentConfigs.provider,
      set: { enabled: true, configJson: { api_base: "https://pay.9527.tr", token: "t", ...extra }, updatedAt: new Date() },
    })
    .run();
}

afterEach(() => {
  process.env.PAYMENT_DRIVER = prevDriver;
});

function enableBepusdt(extra: Record<string, unknown> = {}): void {
  // 用 upsert：共享测试库里可能已存在 bepusdt 配置；冲突时同步更新 configJson
  const configJson = { api_base: "https://pay.example.com", token: "t", ...extra };
  db.insert(paymentConfigs)
    .values({
      provider: "bepusdt",
      enabled: true,
      configJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: paymentConfigs.provider,
      set: { enabled: true, configJson, updatedAt: new Date() },
    })
    .run();
}

describe("auto 只选网关渠道", () => {
  it("litepay 渠道先于 bepusdt 启用时，auto 仍选 bepusdt（同序按名称，可复现）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    enableLitepay();
    enableBepusdt();

    const chosen = resolvePaymentProviderDefault();
    expect(chosen.name).toBe("bepusdt");
  });

  it("多个网关渠道时按固定优先级选 bepusdt（结果可复现）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    enableBepusdt();
    for (let i = 0; i < 5; i++) expect(resolvePaymentProviderDefault().name).toBe("bepusdt");
  });

  it("只有 litepay 启用时，auto 直接选 litepay（它是带收银台的网关渠道）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    db.update(paymentConfigs)
      .set({ enabled: false })
      .where(eq(paymentConfigs.provider, "bepusdt"))
      .run();
    enableLitepay();
    const chosen = resolvePaymentProviderDefault();
    expect(chosen.name).toBe("litepay");
  });

  it("生产环境无任何启用渠道时必须抛错（不静默降级）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    db.update(paymentConfigs)
      .set({ enabled: false })
      .run(); // 关闭全部渠道
    vi.stubEnv("NODE_ENV", "production");
    try {
      expect(() => resolvePaymentProviderDefault()).toThrow(/未启用任何支付渠道/);
    } finally {
      vi.unstubAllEnvs();
    }
  });
});

describe("前台可选支付方式", () => {
  it("未启用 litepay 时只暴露 bepusdt", () => {
    enableBepusdt();
    expect(listCheckoutMethods()).toEqual(["bepusdt"]);
  });

  it("litepay 启用时两者都可选", () => {
    enableBepusdt();
    enableLitepay();
    expect(listCheckoutMethods()).toEqual(["bepusdt", "litepay"]);
  });

  it("litepay 未启用时不暴露（避免选了付不了）", () => {
    enableBepusdt();
    expect(listCheckoutMethods()).toEqual(["bepusdt"]);
  });

  it("bepusdt 后台停用时不暴露（回归：停用渠道仍对买家可见，会被带到旧网关）", () => {
    db.update(paymentConfigs).set({ enabled: false }).where(eq(paymentConfigs.provider, "bepusdt")).run();
    enableLitepay();
    expect(listCheckoutMethods()).toEqual(["litepay"]);
  });

  it("PAYMENT_DRIVER=bepusdt 强制时无视后台开关仍暴露 bepusdt", () => {
    process.env.PAYMENT_DRIVER = "bepusdt";
    db.update(paymentConfigs).set({ enabled: false }).run();
    expect(listCheckoutMethods()).toEqual(["bepusdt"]);
  });
});

describe("渠道优先级与显示名称（后台可配置）", () => {
  it("sort_order 小的渠道排前：前台展示顺序与 auto 默认渠道一致", () => {
    process.env.PAYMENT_DRIVER = "auto";
    enableBepusdt({ sort_order: 10 });
    enableLitepay({ sort_order: 0 });
    expect(listCheckoutMethods()).toEqual(["litepay", "bepusdt"]);
    expect(resolvePaymentProviderDefault().name).toBe("litepay");
  });

  it("未配置 sort_order 时同序按名称排序（bepusdt 在前，保持既有默认）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    enableLitepay();
    enableBepusdt();
    expect(listCheckoutMethods()).toEqual(["bepusdt", "litepay"]);
    expect(resolvePaymentProviderDefault().name).toBe("bepusdt");
  });

  it("自定义显示名称覆盖默认文案，留空回落默认", () => {
    process.env.PAYMENT_DRIVER = "auto";
    enableBepusdt({ display_name: "USDT 支付" });
    enableLitepay();
    const options = getCheckoutOptions();
    expect(options.find((o) => o.method === "bepusdt")?.label).toBe("USDT 支付");
    expect(options.find((o) => o.method === "litepay")?.label).toBe("LitePay 收银台（USDT / USDC）");
  });

  it("非法 sort_order 回落 0（负数/非数字不生效）", () => {
    process.env.PAYMENT_DRIVER = "auto";
    enableBepusdt({ sort_order: -5 });
    enableLitepay({ sort_order: "abc" });
    // 两者都回落 0 → 同序按名称：bepusdt 在前
    expect(listCheckoutMethods()).toEqual(["bepusdt", "litepay"]);
  });
});
