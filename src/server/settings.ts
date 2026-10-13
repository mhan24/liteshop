import { normalizeHttpUrl } from "@/lib/http-url";
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
  /** 页脚「Powered by liteshop」指向的开源仓库地址 */
  repoUrl: "repo_url",
  /** 联系客服地址（Telegram / 工单 / 邮箱等） */
  supportUrl: "support_url",
} as const;

/**
 * 页脚仓库链接的默认地址。
 * 可通过后台「站点设置 → 开源仓库地址」覆盖；留空表示不显示链接。
 */
export const DEFAULT_REPO_URL = "https://github.com/mhan24/liteshop";

/**
 * 联系客服的默认地址。
 * 可通过后台「站点设置 → 联系客服地址」覆盖；留空表示不显示入口。
 */
export const DEFAULT_SUPPORT_URL = "https://t.me/setup0de?direct";

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
  const safe = normalizeHttpUrl(raw) ?? normalizeHttpUrl(envConfig.siteUrl) ?? "http://localhost:3000";
  const url = new URL(safe);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/**
 * 页脚仓库地址。返回 null 表示不渲染链接。
 *
 * 该值会作为 <a href> 输出，因此必须严格校验为 http(s) 绝对地址：
 * 放任 javascript: / data: 等协议会形成 XSS（点击即执行）。
 * 校验失败时回落默认值，而不是把可疑值渲染出去。
 */
export function getRepoUrl(): string | null {
  const raw = getSetting(SETTING_KEYS.repoUrl)?.trim();
  // 显式留空（设置为 ""）视为「不显示」；未设置（null）则用默认值
  if (raw === "") return null;
  const candidate = raw && raw !== "" ? raw : DEFAULT_REPO_URL;
  return isSafeHttpUrl(candidate) ? candidate : DEFAULT_REPO_URL;
}

/**
 * 联系客服地址。返回 null 表示不渲染入口。
 *
 * 语义与 getRepoUrl 一致：未设置(null) → 用默认值；显式留空("") → 不显示；
 * 非法值 → 回落默认。该值会输出为 <a href>，因此必须严格校验为 http(s)。
 */
export function getSupportUrl(): string | null {
  const raw = getSetting(SETTING_KEYS.supportUrl)?.trim();
  if (raw === "") return null;
  const candidate = raw && raw !== "" ? raw : DEFAULT_SUPPORT_URL;
  return isSafeHttpUrl(candidate) ? candidate : DEFAULT_SUPPORT_URL;
}

/** 仅接受 http/https 绝对地址（用于任何会输出为链接的设置项） */
export function isSafeHttpUrl(value: string): boolean {
  // 复用 lib/http-url 的统一实现：除协议外还拒绝内嵌凭据
  // （http://user:pass@host）与控制字符，比只看 protocol 更严。
  return normalizeHttpUrl(value) !== null;
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
