/** 交易所收款的共用类型 */

export type ExchangeId = "binance" | "okx";

export const EXCHANGE_IDS: readonly ExchangeId[] = ["binance", "okx"] as const;

export function isExchangeId(v: string): v is ExchangeId {
  return (EXCHANGE_IDS as readonly string[]).includes(v);
}

export interface ExchangeCredentials {
  apiKey: string;
  apiSecret: string;
  /**
   * 收款账户标识：币安为 Binance ID，欧易为 UID。
   * 到账流水的收款方必须与之匹配（防止配错账户导致把别人的到账当作本店收款）。
   */
  accountId: string;
  /** 仅欧易需要（API Key 的 passphrase） */
  passphrase?: string;
  /** 自定义 API 域名（默认按交易所官方域名；可用于地域镜像） */
  apiBase?: string;
}

/** 一笔到账流水（已归一化，便于匹配） */
export interface ExchangeTransaction {
  /** 交易所账单/交易唯一号 —— 幂等与去重的依据 */
  tradeId: string;
  /** 到账时间（毫秒） */
  timestamp: number;
  /** 到账金额，**原样字符串**（禁浮点，比较时按最小单位转整数） */
  amount: string;
  /** 币种（如 USDT） */
  currency: string;
  /** 收款方标识（币安为 binanceId；欧易接口不返回，为 null） */
  receiver: string | null;
  /** 原始行快照（对账留痕） */
  raw: unknown;
}

export interface CredentialCheck {
  ok: boolean;
  /** 交易所返回的账户标识，用于与配置的 accountId 比对 */
  accountId?: string;
  error?: string;
}

export interface ExchangeClient {
  readonly id: ExchangeId;
  /** 凭据校验：确认 Key 有效、权限为只读、且账户与配置一致 */
  validateCredentials(cred: ExchangeCredentials): Promise<CredentialCheck>;
  /** 拉取 [from, to] 时间窗内的到账流水（按币种过滤） */
  fetchIncoming(
    cred: ExchangeCredentials,
    from: number,
    to: number,
    currency: string
  ): Promise<ExchangeTransaction[]>;
}

/** 统一的 HTTP 超时：交易所偶发慢响应不应拖住整个扫描 */
export const EXCHANGE_TIMEOUT_MS = 12_000;

export class ExchangeApiError extends Error {
  readonly retryable: boolean;
  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "ExchangeApiError";
    this.retryable = retryable;
  }
}

/**
 * 带超时的 JSON 请求。
 *
 * 网络层失败与 5xx 标记为**可重试**：交易所查流水是只读操作，
 * 失败时绝不能据此改动订单状态（保持 pending/待对账由调用方决定）。
 */
export async function fetchJson(
  url: string,
  init: RequestInit = {}
): Promise<unknown> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(EXCHANGE_TIMEOUT_MS) });
  } catch (err) {
    throw new ExchangeApiError(
      `请求交易所失败: ${err instanceof Error ? err.message : String(err)}`,
      true
    );
  }
  const text = await res.text();
  if (!res.ok) {
    // 5xx / 429 / 408 可重试；4xx 多为参数或鉴权错误，重试无意义
    const retryable = res.status >= 500 || res.status === 429 || res.status === 408;
    throw new ExchangeApiError(`交易所 HTTP ${res.status}: ${text.slice(0, 200)}`, retryable);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new ExchangeApiError(`交易所响应无法解析为 JSON: ${text.slice(0, 200)}`, true);
  }
}

/** 安全取对象字段（响应结构不可信） */
export function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : null;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

export function asString(v: unknown): string | null {
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}
