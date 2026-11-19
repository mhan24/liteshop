import { normalizeHttpUrl } from "@/lib/http-url";
import { litepaySign, parseJsonObject, safeEqualHex } from "@/lib/litepay-sign";
import { minorToNumber, SITE_CURRENCY, toMinorUnits } from "@/lib/money";
import { revealSecret } from "@/lib/secret-box";
import { getSetting, SETTING_KEYS } from "@/server/settings";
import type {
  CreateOutcome,
  CreatePaymentInput,
  GatewayRuntime,
  NotifyVerification,
  PaymentAdapter,
} from "./types";

/**
 * LitePay 收银台适配器（BEpusdt 兼容 JSON 接口，mhan24/litepay）。
 *
 * 契约要点（按网关源码 internal/server/bepusdt.go 对齐）：
 * - 下单 POST {api_base}/api/v1/order/create-order，MD5 签名（见 lib/litepay-sign）
 * - 请求字段：order_id / notify_url / redirect_url / amount（JSON number）/ name /
 *   fiat（只接受 USD）/ timeout（0 或 120–86400 秒）/ reselect / currencies（可选）
 * - 业务失败同样是 HTTP 200 + status_code>=400，必须按 message 判为拒绝
 * - 响应 data：trade_id / payment_url / expiration_time（剩余秒）/ amount（法币）
 * - 回调 POST JSON：trade_id / order_id / amount / actual_amount / token /
 *   block_transaction_id / status / signature，只会有 status=2（成功）
 * - 商户应答：HTTP 2xx + 正文 success（网关判定交付完成）
 * - 关单 POST {api_base}/api/v1/order/cancel-transaction {trade_id, signature}
 *
 * 金额限制：网关只受理 [0.0001, 1000000) USD，且回调验签要求金额保持十进制形态；
 * 本站按美分结算，因此可用区间是 0.01–999999.99 USD，超出直接拒绝建单。
 */

export const LITEPAY_CHANNEL = "litepay" as const;

export const MIN_TIMEOUT_SECONDS = 120;
export const MAX_TIMEOUT_SECONDS = 86_400;
export const DEFAULT_TIMEOUT_SECONDS = 600;
export const MIN_AMOUNT_CENTS = 1;
export const MAX_AMOUNT_CENTS = 99_999_999;

const CREATE_PATH = "/api/v1/order/create-order";
const CANCEL_PATH = "/api/v1/order/cancel-transaction";
const REQUEST_TIMEOUT_MS = 15_000;

export interface LitepayConfig {
  /** 是否启用网关（关闭时前台不接受下单） */
  enabled: boolean;
  /** 网关地址（origin；非法或未填写为 null） */
  apiBase: string | null;
  /** 是否已保存接口令牌（后台表单用，不回显明文） */
  hasToken: boolean;
  /** 解密后的令牌（服务端内部使用） */
  token: string | null;
  timeoutSeconds: number;
  /** 收银台币种限制，如 "USDT,USDC" */
  currencies: string | null;
  reselect: boolean;
}

export function normalizeTimeout(raw: number | string | null | undefined): number {
  const n = typeof raw === "string" ? Number(raw) : raw;
  if (n == null || !Number.isFinite(n)) return DEFAULT_TIMEOUT_SECONDS;
  const sec = Math.trunc(n);
  if (sec === 0) return DEFAULT_TIMEOUT_SECONDS;
  return Math.min(Math.max(sec, MIN_TIMEOUT_SECONDS), MAX_TIMEOUT_SECONDS);
}

function normalizeApiBase(raw: string | null | undefined): string | null {
  const origin = normalizeHttpUrl(raw ?? undefined);
  return origin ? origin.replace(/\/+$/, "") : null;
}

/** 读取网关配置（settings KV；令牌解密后仅存在于服务端内存） */
export async function getLitepayConfig(): Promise<LitepayConfig> {
  const [enabled, apiBase, tokenEnc, timeout, currencies, reselect] = await Promise.all([
    getSetting(SETTING_KEYS.litepayEnabled),
    getSetting(SETTING_KEYS.litepayApiBase),
    getSetting(SETTING_KEYS.litepayTokenEnc),
    getSetting(SETTING_KEYS.litepayTimeoutSeconds),
    getSetting(SETTING_KEYS.litepayCurrencies),
    getSetting(SETTING_KEYS.litepayReselect),
  ]);
  // AUTH_SECRET 变更后旧密文解不开：视为未配置，等后台重新录入令牌
  const token = revealSecret(tokenEnc) || null;
  return {
    enabled: enabled === "1",
    apiBase: normalizeApiBase(apiBase),
    hasToken: token !== null,
    token,
    timeoutSeconds: normalizeTimeout(timeout),
    currencies: (currencies ?? "").trim() === "" ? null : currencies!.trim(),
    reselect: reselect !== "0",
  };
}

export function toGatewayRuntime(cfg: LitepayConfig): GatewayRuntime {
  return {
    type: LITEPAY_CHANNEL,
    apiBase: cfg.apiBase,
    token: cfg.token,
    currencies: cfg.currencies,
    timeoutSeconds: cfg.timeoutSeconds,
    reselect: cfg.reselect,
  };
}

/** 网关是否可用（启用 + 地址 + 令牌齐备） */
export function isLitepayReady(cfg: LitepayConfig): boolean {
  return cfg.enabled && cfg.apiBase !== null && cfg.token !== null;
}

interface CreateOrderResponse {
  status_code?: number;
  message?: string;
  data?: {
    trade_id?: string;
    payment_url?: string;
    expiration_time?: number | string;
    amount?: string | number;
  };
}

export const litepayAdapter: PaymentAdapter = {
  type: LITEPAY_CHANNEL,

  async createPayment(gateway, input: CreatePaymentInput): Promise<CreateOutcome> {
    if (!gateway.apiBase || !gateway.token) {
      return { kind: "rejected", message: "LitePay 未配置网关地址或接口令牌" };
    }
    if (input.amountCents < MIN_AMOUNT_CENTS || input.amountCents > MAX_AMOUNT_CENTS) {
      return {
        kind: "rejected",
        message: "订单金额超出 LitePay 受理范围（0.01–999999.99 USD）",
      };
    }
    const body: Record<string, unknown> = {
      order_id: input.orderNo,
      notify_url: input.notifyUrl,
      redirect_url: input.redirectUrl,
      amount: minorToNumber(input.amountCents),
      fiat: SITE_CURRENCY,
      name: input.subject,
      timeout: normalizeTimeout(gateway.timeoutSeconds),
      reselect: gateway.reselect,
      ...(gateway.currencies ? { currencies: gateway.currencies } : {}),
    };
    const signed = { ...body, signature: litepaySign(body, gateway.token) };

    let res: Response;
    try {
      res = await fetch(`${gateway.apiBase}${CREATE_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
    } catch (err) {
      return {
        kind: "unknown",
        message: `创建订单请求失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 5xx/408/429 无法证明未建单 → unknown；其它非 2xx 明确拒绝
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const ambiguous = res.status >= 500 || res.status === 408 || res.status === 429;
      return {
        kind: ambiguous ? "unknown" : "rejected",
        message: `创建订单 HTTP ${res.status}: ${text.slice(0, 200)}`,
      };
    }

    let json: unknown;
    try {
      json = await res.json();
    } catch {
      return { kind: "unknown", message: "创建订单响应无法解析（网关可能已建单）" };
    }
    if (typeof json !== "object" || json === null || Array.isArray(json)) {
      return { kind: "unknown", message: "创建订单响应结构异常" };
    }
    const parsed = json as CreateOrderResponse;
    if (typeof parsed.status_code === "number" && parsed.status_code >= 400) {
      return { kind: "rejected", message: parsed.message ?? `网关拒绝建单（${parsed.status_code}）` };
    }
    const data = parsed.data;
    const tradeId = typeof data?.trade_id === "string" ? data.trade_id.trim() : "";
    const rawUrl = typeof data?.payment_url === "string" ? data.payment_url.trim() : "";
    if (!tradeId || !rawUrl) {
      return {
        kind: "unknown",
        message: `创建订单响应不完整: ${parsed.message ?? JSON.stringify(parsed).slice(0, 200)}`,
      };
    }
    const paymentUrl = normalizeHttpUrl(rawUrl);
    if (!paymentUrl) {
      return { kind: "unknown", message: "收银台地址协议或格式不安全，订单保留待对账" };
    }
    // expiration_time 是「剩余秒数」而非 Unix 时间戳
    const expSeconds =
      typeof data?.expiration_time === "string" ? Number(data.expiration_time) : data?.expiration_time;
    const hasExpiry = typeof expSeconds === "number" && Number.isFinite(expSeconds) && expSeconds > 0;
    return {
      kind: "created",
      payment: {
        providerRef: tradeId,
        paymentUrl,
        // 建单响应只有法币金额；加密货币实付数量由回调 actual_amount 给出，
        // 两者口径不同，不能互相核对。
        expectedAmount: null,
        expiresAt: hasExpiry
          ? new Date(Date.now() + (expSeconds as number) * 1000)
          : new Date(Date.now() + normalizeTimeout(gateway.timeoutSeconds) * 1000),
        raw: data,
      },
    };
  },

  verifyNotify(gateway, rawBody): NotifyVerification {
    if (!gateway.token) return { ok: false, error: "接口令牌未配置" };
    const parsed = parseJsonObject(rawBody);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const body = parsed.value;
    const given = body["signature"];
    if (typeof given !== "string" || given === "") return { ok: false, error: "缺少签名" };
    if (!safeEqualHex(litepaySign(body, gateway.token), given)) {
      return { ok: false, error: "签名校验失败" };
    }
    const status = Number(body["status"]);
    if (!Number.isInteger(status)) return { ok: false, error: `非法 status: ${String(body["status"])}` };
    const orderNo = String(body["order_id"] ?? "").trim();
    if (!orderNo) return { ok: false, error: "缺少 order_id" };
    const providerRef = body["trade_id"] != null ? String(body["trade_id"]).trim() : "";
    if (!providerRef) return { ok: false, error: "缺少 trade_id" };
    const amount = body["amount"] ?? null;
    if (amount !== null && typeof amount !== "string" && typeof amount !== "number") {
      return { ok: false, error: "回调金额类型非法" };
    }
    if (amount !== null && toMinorUnitsOrNull(amount) === null) {
      return { ok: false, error: `回调金额非法: ${String(amount)}` };
    }
    return {
      ok: true,
      payload: {
        providerRef,
        orderNo,
        amount: amount as string | number | null,
        actualAmount: body["actual_amount"] != null ? String(body["actual_amount"]) : null,
        status,
      },
    };
  },

  async cancelPayment(gateway, providerRef) {
    if (!gateway.apiBase || !gateway.token) return { ok: false, message: "网关未配置，跳过撤销" };
    const body = { trade_id: providerRef };
    try {
      const res = await fetch(`${gateway.apiBase}${CANCEL_PATH}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, signature: litepaySign(body, gateway.token) }),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        redirect: "error",
      });
      const json = (await res.json().catch(() => null)) as { status_code?: number; message?: string } | null;
      if (res.ok && typeof json?.status_code === "number" && json.status_code < 400) {
        return { ok: true, message: "网关已受理撤销" };
      }
      return { ok: false, message: `网关未受理撤销: HTTP ${res.status} ${json?.message ?? ""}`.trim() };
    } catch (err) {
      return {
        ok: false,
        message: `撤销请求失败: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
};

/** 金额可解析为美分则返回数值，否则 null（用于回调报文端口级校验） */
function toMinorUnitsOrNull(v: string | number): number | null {
  try {
    return toMinorUnits(v);
  } catch {
    return null;
  }
}
