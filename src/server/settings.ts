import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { appConfig } from "@/db/schema";
import { normalizeHttpUrl } from "@/lib/http-url";
import { isEncryptedSecret, revealSecret } from "@/lib/secret-box";

/**
 * 站点配置：app_config 表里唯一的一行 JSON，由下面的 Zod 结构定义类型与默认值。
 *
 * - 读：整份配置一次查询，进程内缓存（单实例部署；写入时同步失效）
 * - 写：updateConfig() 在事务内行锁读取 → 合并 → 整体校验 → 写回
 * - 容错：单个字段缺失或格式不对只回落该字段默认值，不拖垮整份配置
 * - 凭据字段（*Enc）只存 AES-GCM 密文（lib/secret-box），明文永不落库
 */

const str = (fallback = "") => z.string().trim().catch(fallback);
const bool = (fallback: boolean) => z.boolean().catch(fallback);
const int = (fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER) =>
  z.number().int().min(min).max(max).catch(fallback);
/** 密文字段：不是 enc:v1 密文一律视为未设置 */
const secret = () =>
  z
    .string()
    .catch("")
    .transform((v) => (isEncryptedSecret(v) ? v : ""));

export const configSchema = z.object({
  /* 站点 */
  siteName: str(),
  siteUrl: str(),
  supportUrl: str(),
  lowStockThreshold: int(5),
  /* 管理员会话全局版本（改密 / 全局登出时递增） */
  adminSessionVersion: int(1, 1),
  /* LitePay 网关 */
  litepayEnabled: bool(false),
  litepayApiBase: str(),
  litepayTokenEnc: secret(),
  litepayTimeoutSeconds: int(600, 120, 86_400),
  litepayCurrencies: str(),
  litepayReselect: bool(true),
  /* 交付邮件（SMTP） */
  smtpEnabled: bool(false),
  smtpHost: str(),
  smtpPort: int(465, 1, 65_535),
  smtpSecure: bool(true),
  smtpUser: str(),
  smtpPassEnc: secret(),
  smtpFrom: str(),
  /* Cloudflare Turnstile 人机验证 */
  turnstileEnabled: bool(false),
  turnstileSiteKey: str(),
  turnstileSecretEnc: secret(),
  turnstileFallback: bool(false),
  /* 运营通知（Telegram） */
  telegramEnabled: bool(false),
  telegramBotTokenEnc: secret(),
  telegramChatId: str(),
});

export type AppConfig = z.infer<typeof configSchema>;

let cache: Promise<AppConfig> | null = null;

async function load(): Promise<AppConfig> {
  const rows = await db.select({ data: appConfig.data }).from(appConfig).where(eq(appConfig.id, 1)).limit(1);
  return configSchema.parse(rows[0]?.data ?? {});
}

/** 当前配置（进程内缓存） */
export function getConfig(): Promise<AppConfig> {
  if (!cache) {
    cache = load();
    cache.catch(() => {
      cache = null; // 数据库暂时不可用时不缓存失败结果
    });
  }
  return cache;
}

/** 丢弃缓存（测试直接改库后调用；业务写入走 updateConfig 自动失效） */
export function invalidateConfig(): void {
  cache = null;
}

/** 修改配置：行锁内读取最新值 → 合并补丁（可为函数）→ 整体校验 → 写回 */
export async function updateConfig(
  patch: Partial<AppConfig> | ((current: AppConfig) => Partial<AppConfig>)
): Promise<AppConfig> {
  const next = await db.transaction(async (tx) => {
    await tx.execute(sql`INSERT INTO app_config (id, data) VALUES (1, '{}'::jsonb) ON CONFLICT (id) DO NOTHING`);
    const rows = await tx.select({ data: appConfig.data }).from(appConfig).where(eq(appConfig.id, 1)).for("update");
    const current = configSchema.parse(rows[0]?.data ?? {});
    const merged = configSchema.parse({ ...current, ...(typeof patch === "function" ? patch(current) : patch) });
    await tx.update(appConfig).set({ data: merged, updatedAt: new Date() }).where(eq(appConfig.id, 1));
    return merged;
  });
  cache = Promise.resolve(next);
  return next;
}

/* ===== 派生读取（调用方不必关心存储细节） ===== */

export async function getSiteName(): Promise<string> {
  return (await getConfig()).siteName || "liteshop";
}

/** 站点对外地址：配置优先，回落 env。用于 canonical / sitemap / 支付回调与回跳 URL */
export async function getSiteUrl(): Promise<string> {
  const envUrl = process.env.SITE_URL ?? "http://localhost:3000";
  const safe = normalizeHttpUrl((await getConfig()).siteUrl || envUrl) ?? normalizeHttpUrl(envUrl) ?? "http://localhost:3000";
  const url = new URL(safe);
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/+$/, "");
}

/** 联系客服地址（输出为 <a href>，必须严格 http/https；未配置返回 null） */
export async function getSupportUrl(): Promise<string | null> {
  const raw = (await getConfig()).supportUrl;
  return raw && normalizeHttpUrl(raw) ? raw : null;
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
  const c = await getConfig();
  return {
    enabled: c.smtpEnabled,
    host: c.smtpHost,
    port: c.smtpPort,
    secure: c.smtpSecure,
    user: c.smtpUser,
    pass: revealSecret(c.smtpPassEnc),
    from: c.smtpFrom,
  };
}

/* ===== Turnstile 人机验证（下单与查单两个公开入口共用） ===== */

/** 是否强制人机验证：总开关开启且两把 Key 都已配置（缺一不生效，避免半配置态拦死所有人） */
export async function isTurnstileEnforced(): Promise<boolean> {
  const c = await getConfig();
  return c.turnstileEnabled && c.turnstileSiteKey !== "" && c.turnstileSecretEnc !== "";
}

export interface TurnstileClientConfig {
  enabled: boolean;
  siteKey: string;
  /** 验证服务不可用时允许提交（降级开关） */
  fallback: boolean;
}

/** 前台配置（仅站点 Key；Secret 只在服务端使用，绝不下发） */
export async function getTurnstileClientConfig(): Promise<TurnstileClientConfig> {
  const [enforced, c] = await Promise.all([isTurnstileEnforced(), getConfig()]);
  return { enabled: enforced, siteKey: enforced ? c.turnstileSiteKey : "", fallback: c.turnstileFallback };
}

export async function getTurnstileSecretKey(): Promise<string> {
  return revealSecret((await getConfig()).turnstileSecretEnc);
}

/**
 * 验证服务不可用时的降级开关：开启后，前端拿不到 token（加载失败）仍可提交，
 * 服务端跳过 siteverify，由下单/查单频率限制兜底。适用于买家到 Cloudflare 网络不稳定的场景。
 */
export async function isTurnstileFallbackEnabled(): Promise<boolean> {
  return (await getConfig()).turnstileFallback;
}
