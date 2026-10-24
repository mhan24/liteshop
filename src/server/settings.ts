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
  turnstileEnabled: "turnstile_enabled",
  turnstileSiteKey: "turnstile_site_key",
  turnstileSecretKey: "turnstile_secret_key",
  turnstileFallbackEnabled: "turnstile_fallback_enabled",
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

/* ===== Turnstile 人机验证（Cloudflare；下单与查单两个公开入口共用） ===== */

async function turnstileKeysReady(): Promise<boolean> {
  const [siteKey, secretKey] = await Promise.all([
    getSetting(SETTING_KEYS.turnstileSiteKey),
    getSetting(SETTING_KEYS.turnstileSecretKey),
  ]);
  return (siteKey?.trim() ?? "") !== "" && (secretKey?.trim() ?? "") !== "";
}

/** 是否强制人机验证：总开关开启且两把 Key 都已配置（缺一不生效，避免半配置态拦死所有人） */
export async function isTurnstileEnforced(): Promise<boolean> {
  if ((await getSetting(SETTING_KEYS.turnstileEnabled)) !== "1") return false;
  return turnstileKeysReady();
}

export interface TurnstileClientConfig {
  enabled: boolean;
  siteKey: string;
  /** 验证服务不可用时允许提交（降级开关，见 isTurnstileFallbackEnabled） */
  fallback: boolean;
}

/** 前台配置（仅站点 Key；Secret 只在服务端使用，绝不下发） */
export async function getTurnstileClientConfig(): Promise<TurnstileClientConfig> {
  const [enforced, siteKey, fallback] = await Promise.all([
    isTurnstileEnforced(),
    getSetting(SETTING_KEYS.turnstileSiteKey),
    isTurnstileFallbackEnabled(),
  ]);
  return { enabled: enforced, siteKey: enforced ? (siteKey?.trim() ?? "") : "", fallback };
}

export async function getTurnstileSecretKey(): Promise<string> {
  return (await getSetting(SETTING_KEYS.turnstileSecretKey))?.trim() ?? "";
}

/**
 * 验证服务不可用时的降级开关：
 * 开启后，前端拿不到 Turnstile token（加载失败）仍可提交，
 * 服务端跳过 siteverify，由既有的下单/查单频率限制兜底。
 * 适用于买家网络到 challenges.cloudflare.com 不稳定（如中国大陆）的场景。
 */
export async function isTurnstileFallbackEnabled(): Promise<boolean> {
  return (await getSetting(SETTING_KEYS.turnstileFallbackEnabled)) === "1";
}

export async function bumpAdminSessionVersion(): Promise<void> {
  const v = await getAdminSessionVersion();
  await setSetting(SETTING_KEYS.adminSessionVersion, String(v + 1));
}
