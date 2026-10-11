import { eq } from "drizzle-orm";
import { db } from "@/db";
import { paymentConfigs, settings } from "@/db/schema";
import { envConfig } from "@/lib/env";

/** 站点级设置（settings 表仅存站点配置；支付渠道在 payment_configs） */

export const SETTING_KEYS = {
  siteName: "site_name",
  siteUrl: "site_url",
  cardLowStockThreshold: "card_low_stock_threshold",
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

/** 站点对外地址：settings.site_url 优先，回落 env；用于 notify_url / redirect_url */
export function getSiteUrl(): string {
  const fromDb = getSetting(SETTING_KEYS.siteUrl)?.trim();
  const raw = fromDb && fromDb !== "" ? fromDb : envConfig.siteUrl;
  return raw.replace(/\/+$/, "");
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
