import { eq } from "drizzle-orm";
import { db } from "@/db";
import { settings } from "@/db/schema";
import { normalizeHttpUrl } from "@/lib/http-url";

/** 站点级配置（KV 表；支付渠道在 payment_channels 表）。node-postgres 为异步 API。 */

export const SETTING_KEYS = {
  siteName: "site_name",
  siteUrl: "site_url",
  currency: "currency",
  supportUrl: "support_url",
  cardLowStockThreshold: "card_low_stock_threshold",
  adminSessionVersion: "admin_session_version",
  smtpEnabled: "smtp_enabled",
  smtpHost: "smtp_host",
  smtpPort: "smtp_port",
  smtpSecure: "smtp_secure",
  smtpUser: "smtp_user",
  smtpPass: "smtp_pass",
  smtpFrom: "smtp_from",
} as const;

export const SUPPORTED_CURRENCIES = ["USD", "CNY", "EUR", "GBP", "JPY"] as const;

export async function getAllSettings(): Promise<Record<string, string>> {
  const rows = await db.select().from(settings);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

export async function getSetting(key: string): Promise<string | null> {
  const rows = await db.select().from(settings).where(eq(settings.key, key)).limit(1);
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  await db
    .insert(settings)
    .values({ key, value, updatedAt: new Date() })
    .onConflictDoUpdate({ target: settings.key, set: { value, updatedAt: new Date() } });
}

export async function getSettingNumber(key: string, fallback: number): Promise<number> {
  const v = Number(await getSetting(key));
  return Number.isFinite(v) && v >= 0 ? Math.trunc(v) : fallback;
}

export async function getSiteName(): Promise<string> {
  return (await getSetting(SETTING_KEYS.siteName))?.trim() || "liteshop";
}

/** 站点默认币种（新商品定价、订单与支付渠道 fiat 全站统一跟随） */
export async function getSiteCurrency(): Promise<string> {
  const c = (await getSetting(SETTING_KEYS.currency))?.trim().toUpperCase();
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(c ?? "") ? (c as string) : "USD";
}

/** 站点对外地址：settings.site_url 优先，回落 env。用于 canonical / sitemap / 支付回调与回跳 URL */
export async function getSiteUrl(): Promise<string> {
  const fromDb = (await getSetting(SETTING_KEYS.siteUrl))?.trim();
  const raw = fromDb && fromDb !== "" ? fromDb : (process.env.SITE_URL ?? "http://localhost:3000");
  const safe = normalizeHttpUrl(raw) ?? normalizeHttpUrl(envSiteUrl()) ?? "http://localhost:3000";
  const url = new URL(safe);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

function envSiteUrl(): string {
  return process.env.SITE_URL ?? "http://localhost:3000";
}

/** 联系客服地址（输出为 <a href>，必须严格 http/https；未配置返回 null） */
export async function getSupportUrl(): Promise<string | null> {
  const raw = (await getSetting(SETTING_KEYS.supportUrl))?.trim();
  if (!raw) return null;
  try {
    const u = new URL(raw);
    return u.protocol === "http:" || u.protocol === "https:" ? raw : null;
  } catch {
    return null;
  }
}

export async function getCardLowStockThreshold(): Promise<number> {
  return getSettingNumber(SETTING_KEYS.cardLowStockThreshold, 5);
}

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export async function getSmtpConfig(): Promise<SmtpConfig> {
  const [enabled, host, port, secure, user, pass, from] = await Promise.all([
    getSetting(SETTING_KEYS.smtpEnabled),
    getSetting(SETTING_KEYS.smtpHost),
    getSetting(SETTING_KEYS.smtpPort),
    getSetting(SETTING_KEYS.smtpSecure),
    getSetting(SETTING_KEYS.smtpUser),
    getSetting(SETTING_KEYS.smtpPass),
    getSetting(SETTING_KEYS.smtpFrom),
  ]);
  const portNum = Number(port);
  return {
    enabled: enabled === "1",
    host: host?.trim() ?? "",
    port: Number.isInteger(portNum) && portNum > 0 ? portNum : 465,
    secure: secure !== "0",
    user: user?.trim() ?? "",
    pass: pass ?? "",
    from: from?.trim() ?? "",
  };
}

/** 管理员会话全局版本（登出所有会话/改密时递增） */
export async function getAdminSessionVersion(): Promise<number> {
  return getSettingNumber(SETTING_KEYS.adminSessionVersion, 1);
}

export async function bumpAdminSessionVersion(): Promise<void> {
  const v = await getAdminSessionVersion();
  await setSetting(SETTING_KEYS.adminSessionVersion, String(v + 1));
}
