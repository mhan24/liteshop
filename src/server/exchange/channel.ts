import { db } from "@/db";
import { paymentConfigs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { decryptSecret, encryptSecret, isEncrypted } from "./credentials";
import { isExchangeId, type ExchangeCredentials, type ExchangeId } from "./types";

/**
 * 交易所渠道配置的读写（凭据**加密存储**）。
 *
 * 存放于既有 payment_configs 表，config_json 里：
 *   accountId        收款账户标识（币安 Binance ID / 欧易 UID）——非机密
 *   asset            收款币种（USDT / USDC）
 *   rate             汇率字符串（1 USDT 值多少站点币种）
 *   apiKey           非机密，可明文
 *   apiSecretEnc     密文（AES-256-GCM）
 *   passphraseEnc    密文（仅欧易）
 *
 * 前端只读取脱敏视图，永远不返回密文或明文密钥。
 */

const PREFIX = "exchange:";
export const EXCHANGE_ASSETS = ["USDT", "USDC"] as const;
export type ExchangeAsset = (typeof EXCHANGE_ASSETS)[number];

/** 前端可见的安全视图（不含任何密钥） */
export interface ExchangeChannelView {
  provider: ExchangeId;
  enabled: boolean;
  accountId: string;
  asset: ExchangeAsset;
  rate: string;
  /** 是否已配置密钥（用于提示管理员完成配置） */
  hasApiKey: boolean;
  hasSecret: boolean;
  hasPassphrase: boolean;
}

interface StoredConfig {
  accountId?: unknown;
  asset?: unknown;
  rate?: unknown;
  apiKey?: unknown;
  apiSecretEnc?: unknown;
  passphraseEnc?: unknown;
}

function providerKey(id: ExchangeId): string {
  return `${PREFIX}${id}`;
}

function readRow(id: ExchangeId) {
  return db
    .select()
    .from(paymentConfigs)
    .where(eq(paymentConfigs.provider, providerKey(id)))
    .get();
}

/** 读取可展示的渠道配置（不含密钥） */
export function getExchangeChannelView(id: ExchangeId): ExchangeChannelView {
  const row = readRow(id);
  const cfg: StoredConfig = (row?.configJson ?? {}) as StoredConfig;
  const asset = EXCHANGE_ASSETS.includes(cfg.asset as ExchangeAsset)
    ? (cfg.asset as ExchangeAsset)
    : "USDT";
  return {
    provider: id,
    enabled: row?.enabled ?? false,
    accountId: typeof cfg.accountId === "string" ? cfg.accountId : "",
    asset,
    rate: typeof cfg.rate === "string" && cfg.rate.trim() !== "" ? cfg.rate : "1",
    hasApiKey: typeof cfg.apiKey === "string" && cfg.apiKey !== "",
    hasSecret: typeof cfg.apiSecretEnc === "string" && cfg.apiSecretEnc !== "",
    hasPassphrase:
      typeof cfg.passphraseEnc === "string" && cfg.passphraseEnc !== "",
  };
}

/** 是否存在已启用且配置完整的交易所渠道 */
export function findEnabledExchange(): ExchangeId | null {
  for (const id of ["binance", "okx"] as const) {
    const v = getExchangeChannelView(id);
    if (v.enabled && v.accountId && v.rate && v.hasApiKey && v.hasSecret) {
      if (id === "okx" && !v.hasPassphrase) continue;
      return id;
    }
  }
  return null;
}

/** 读取解密后的运行凭据；未配置完整返回 null */
export function loadExchangeCredentials(id: ExchangeId): {
  cred: ExchangeCredentials;
  asset: ExchangeAsset;
  rate: string;
} | null {
  const view = getExchangeChannelView(id);
  const row = readRow(id);
  if (!row) return null;
  const cfg: StoredConfig = (row.configJson ?? {}) as StoredConfig;

  const encSecret = typeof cfg.apiSecretEnc === "string" ? cfg.apiSecretEnc : "";
  if (!encSecret || !isEncrypted(encSecret)) return null;
  const secret = decryptSecret(encSecret);
  if (secret === null) return null; // 解密失败（密钥不匹配）→ 视为未配置

  const cred: ExchangeCredentials = {
    apiKey: view.hasApiKey ? String(cfg.apiKey) : "",
    apiSecret: secret,
    accountId: view.accountId,
  };
  if (id === "okx") {
    const encPass = typeof cfg.passphraseEnc === "string" ? cfg.passphraseEnc : "";
    const pass = encPass && isEncrypted(encPass) ? decryptSecret(encPass) : null;
    if (!pass) return null;
    cred.passphrase = pass;
  }
  return { cred, asset: view.asset, rate: view.rate };
}

export interface SaveExchangeChannelInput {
  enabled: boolean;
  accountId: string;
  asset: ExchangeAsset;
  rate: string;
  apiKey: string;
  /** 留空表示保持原值不变（避免回显后误清空） */
  apiSecret?: string;
  passphrase?: string;
}

/**
 * 保存渠道配置。密钥留空时保留原值。
 * 返回可展示的错误信息（中文），供后台直接显示。
 */
export function saveExchangeChannel(
  id: ExchangeId,
  input: SaveExchangeChannelInput
): { ok: boolean; error?: string } {
  if (!isExchangeId(id)) return { ok: false, error: "未知的交易所" };
  const accountId = input.accountId.trim();
  if (!/^[1-9]\d*$/.test(accountId)) {
    return { ok: false, error: "收款账户标识应为纯数字（币安 Binance ID / 欧易 UID）" };
  }
  if (!EXCHANGE_ASSETS.includes(input.asset)) {
    return { ok: false, error: "收款币种仅支持 USDT 或 USDC" };
  }
  if (!/^\d+(\.\d+)?$/.test(input.rate.trim()) || Number(input.rate) <= 0) {
    return { ok: false, error: "汇率应为正数，例如 7.25 表示 1 USDT ≈ 7.25 站点币种" };
  }
  const prev = (readRow(id)?.configJson ?? {}) as StoredConfig;
  const next: StoredConfig = {
    ...prev,
    accountId,
    asset: input.asset,
    rate: input.rate.trim(),
  };

  // API Key 与 Secret 同理：留空 = 保留原值（页面不回显密钥，
  // 用户只改其它字段时不应因留空而清空或报错）。
  const apiKey = input.apiKey.trim();
  if (apiKey !== "") next.apiKey = apiKey;

  const secret = input.apiSecret?.trim();
  if (secret) next.apiSecretEnc = encryptSecret(secret);

  // 启用时才要求凭据齐全
  if (input.enabled) {
    if (!next.apiKey) return { ok: false, error: "启用前请填写 API Key" };
    if (!next.apiSecretEnc) return { ok: false, error: "启用前请填写 API Secret" };
  }

  const pass = input.passphrase?.trim();
  if (id === "okx") {
    if (pass) next.passphraseEnc = encryptSecret(pass);
    else if (!prev.passphraseEnc) {
      return { ok: false, error: "欧易需要 API Key 的 passphrase" };
    }
  }

  db.insert(paymentConfigs)
    .values({
      provider: providerKey(id),
      enabled: input.enabled,
      configJson: next as Record<string, unknown>,
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: paymentConfigs.provider,
      set: { enabled: input.enabled, configJson: next as Record<string, unknown>, updatedAt: new Date() },
    })
    .run();

  return { ok: true };
}