import { eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentConfigs, settings } from "@/db/schema";
import { envConfig } from "@/lib/env";
import { SUPPORTED_CURRENCIES } from "@/lib/money";

/** 站点级设置（settings 表仅存站点配置；支付渠道在 payment_configs） */

export const SETTING_KEYS = {
  siteName: "site_name",
  siteUrl: "site_url",
  cardLowStockThreshold: "card_low_stock_threshold",
  currency: "currency",
} as const;

export function getAllSettings(): Record<string, string> {
  const rows = db.select().from(settings).all();
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export function getSetting(key: string): string | null {
  const row = db.select().from(settings).where(eq(settings.key, key)).get();
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } })
    .run();
}

export function getSiteName(): string {
  return getSetting(SETTING_KEYS.siteName) || "liteshop";
}

/** 站点默认币种（未设置时 USD；商品/订单/bepusdt fiat 全站统一跟随） */
export function getSiteCurrency(): string {
  const c = getSetting(SETTING_KEYS.currency)?.trim().toUpperCase();
  return c && (SUPPORTED_CURRENCIES as readonly string[]).includes(c) ? c : "USD";
}

/** 站点对外地址：settings.site_url 优先，回落 env；用于 notify_url / redirect_url */
export function getSiteUrl(): string {
  const fromDb = getSetting(SETTING_KEYS.siteUrl)?.trim();
  const raw = fromDb && fromDb !== "" ? fromDb : envConfig.siteUrl;
  return raw.replace(/\/+$/, "");
}

/**
 * Turnstile 是否应当强制校验（服务端唯一判据）。
 *
 * 必须同时满足：开关打开 + Site Key + Secret Key 三者齐备。
 * 历史缺陷：下单/查单只检查 Secret Key 是否为空，不看开关，
 * 于是「关闭 Turnstile 但保留 Secret」会让前端不再渲染验证码、
 * 服务端却仍强制校验 → 正常买家永远无法下单/查单。
 * 前端渲染与后端校验必须共用本函数，避免再次脱节。
 */
export function isTurnstileEnforced(): boolean {
  const enabled = getSetting("turnstile_enabled") === "1";
  if (!enabled) return false;
  const siteKey = getSetting("turnstile_site_key")?.trim() ?? "";
  const secretKey = getSetting("turnstile_secret_key")?.trim() ?? "";
  return siteKey !== "" && secretKey !== "";
}

/** Turnstile 前台配置（仅站点 Key，Secret 只在服务端使用） */
export function getTurnstileClientConfig(): { enabled: boolean; siteKey: string } {
  const enforced = isTurnstileEnforced();
  return {
    enabled: enforced,
    siteKey: enforced ? (getSetting("turnstile_site_key")?.trim() ?? "") : "",
  };
}

export function getTurnstileSecretKey(): string {
  return getSetting("turnstile_secret_key")?.trim() ?? "";
}

export interface PaymentConfigRow {
  id: number;
  provider: string;
  enabled: boolean;
  configJson: Record<string, unknown>;
}

export function listPaymentConfigs(): PaymentConfigRow[] {
  return db
    .select()
    .from(paymentConfigs)
    .all()
    .map((r) => ({
      id: r.id,
      provider: r.provider,
      enabled: r.enabled,
      configJson: (r.configJson ?? {}) as Record<string, unknown>,
    }));
}

export function getPaymentConfig(provider: string): PaymentConfigRow | null {
  const row = db
    .select()
    .from(paymentConfigs)
    .where(eq(paymentConfigs.provider, provider))
    .get();
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    enabled: row.enabled,
    configJson: (row.configJson ?? {}) as Record<string, unknown>,
  };
}

export function upsertPaymentConfig(
  provider: string,
  data: { enabled: boolean; configJson: Record<string, unknown> }
): void {
  db
    .insert(paymentConfigs)
    .values({
      provider,
      enabled: data.enabled,
      configJson: data.configJson,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: paymentConfigs.provider,
      set: { enabled: data.enabled, configJson: data.configJson, updatedAt: new Date() },
    })
    .run();
}
