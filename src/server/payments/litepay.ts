import { normalizeHttpUrl } from "@/lib/http-url";
import { litepaySign, parseJsonObject, safeEqualHex } from "@/lib/litepay-sign";
import { minorToNumber, SITE_CURRENCY, toMinorUnits } from "@/lib/money";
import { revealSecret } from "@/lib/secret-box";
import { getConfig } from "@/server/settings";
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

/** 网关对外的收银台域名可以与内部 API 不同，但路径必须指向同一笔交易。 */
export function litepayCashierUrl(raw: string | null, tradeId: string | null, apiBase?: string | null): string | null {
  const safe = normalizeHttpUrl(raw);
  if (!safe || !tradeId) return null;
  const cashier = new URL(safe);
  if (cashier.pathname !== `/pay/${encodeURIComponent(tradeId)}` || cashier.search || cashier.hash) return null;
  if (cashier.protocol === "http:" && !apiBase?.toLowerCase().startsWith("http://")) return null;
  return cashier.href;
}

/** 读取网关配置（令牌解密后仅存在于服务端内存） */
export async function getLitepayConfig(): Promise<LitepayConfig> {
  const c = await getConfig();
  // AUTH_SECRET 变更后旧密文解不开：视为未配置，等后台重新录入令牌
  const rawToken = revealSecret(c.litepayTokenEnc);
  const token = rawToken?.trim() ? rawToken : null;
  return {
    enabled: c.litepayEnabled,
    apiBase: normalizeApiBase(c.litepayApiBase),
    hasToken: token !== null,
    token,
    timeoutSeconds: normalizeTimeout(c.litepayTimeoutSeconds),
    currencies: c.litepayCurrencies || null,
    reselect: c.litepayReselect,
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
    order_id?: string;
    status?: number;
    payment_url?: string;
    expiration_time?: number | string;
    amount?: string | number;
  };
}

export const litepayAdapter: PaymentAdapter = {
  type: LITEPAY_CHANNEL,

  async createPayment(gateway, input: CreatePaymentInput): Promise<CreateOutcome> {
    if (!gateway.apiBase || !gateway.token?.trim()) {
      return { kind: "rejected", message: "LitePay 网关地址或接口令牌未配置" };
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
      // LitePay limits name to 255 UTF-8 bytes; the itemized receipt stays in the shop.
      name: Buffer.byteLength(input.subject, "utf8") <= 255 ? input.subject : input.orderNo,
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
        message: `创建订单请求失败：${err instanceof Error ? err.message : String(err)}`,
      };
    }

    // 5xx/408/429 无法证明未建单 → unknown；其它非 2xx 明确拒绝
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      const ambiguous = res.status >= 500 || res.status === 408 || res.status === 429;
      return {
        kind: ambiguous ? "unknown" : "rejected",
        message: `创建订单失败（HTTP ${res.status}）：${text.slice(0, 200)}`,
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
    if (parsed.status_code !== 200) return { kind: "unknown", message: "网关未确认建单结果" };
    const data = parsed.data;
    if ((data?.order_id !== undefined && data.order_id !== input.orderNo) ||
        (data?.amount !== undefined && toMinorUnitsOrNull(data.amount) !== input.amountCents)) {
      return { kind: "unknown", message: "网关返回的商户订单号或金额不符，订单保留待核实" };
    }
    const tradeId = typeof data?.trade_id === "string" ? data.trade_id.trim() : "";
    if ((data?.status === 3 || data?.status === 4) && tradeId && data.order_id === input.orderNo && data.amount !== undefined) {
      return { kind: "closed", providerRef: tradeId, message: data.status === 3 ? "网关订单已过期" : "网关订单已取消" };
    }
    if (data?.status !== undefined && data.status !== 1) {
      return { kind: "unknown", message: "网关交易已结束付款，订单保留待核实" };
    }
    const rawUrl = typeof data?.payment_url === "string" ? data.payment_url.trim() : "";
    if (!tradeId || !rawUrl) {
      return {
        kind: "unknown",
        message: `创建订单响应不完整：${parsed.message ?? JSON.stringify(parsed).slice(0, 200)}`,
      };
    }
    const paymentUrl = litepayCashierUrl(rawUrl, tradeId, gateway.apiBase);
    if (!paymentUrl) {
      return { kind: "unknown", message: "收银台地址与网关交易不符，订单保留待核实" };
    }
    // expiration_time 是「剩余秒数」而非 Unix 时间戳
    const expSeconds =
      typeof data?.expiration_time === "string" ? Number(data.expiration_time) : data?.expiration_time;
    const seconds = expSeconds ?? normalizeTimeout(gateway.timeoutSeconds);
    if (!Number.isInteger(seconds) || seconds <= 0 || seconds > MAX_TIMEOUT_SECONDS) {
      return { kind: "unknown", message: "网关交易已到期或有效期异常，订单保留待核实" };
    }
    return {
      kind: "created",
      payment: {
        providerRef: tradeId,
        paymentUrl,
        // 建单响应只有法币金额；加密货币实付数量由回调 actual_amount 给出，
        // 两者口径不同，不能互相核对。
        expectedAmount: null,
        expiresAt: new Date(Date.now() + seconds * 1000),
        raw: data,
      },
    };
  },

  verifyNotify(gateway, rawBody): NotifyVerification {
    if (!gateway.token?.trim()) return { ok: false, error: "接口令牌未配置" };
    const parsed = parseJsonObject(rawBody);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const body = parsed.value;
    if (Object.values(body).some((v) => typeof v === "number" && !Number.isFinite(v))) {
      return { ok: false, error: "回调报文含无效数值" };
    }
    const given = body["signature"];
    if (typeof given !== "string" || given === "") return { ok: false, error: "缺少签名" };
    if (!safeEqualHex(litepaySign(body, gateway.token), given.trim())) {
      return { ok: false, error: "签名校验失败" };
    }
    const statusValue = body["status"];
    const status = typeof statusValue === "number" || (typeof statusValue === "string" && /^\d+$/.test(statusValue))
      ? Number(statusValue) : NaN;
    if (!Number.isSafeInteger(status)) return { ok: false, error: "回调状态非法" };
    const orderNo = typeof body["order_id"] === "string" ? body["order_id"].trim() : "";
    if (!orderNo) return { ok: false, error: "缺少 order_id" };
    const providerRef = typeof body["trade_id"] === "string" ? body["trade_id"].trim() : "";
    if (!providerRef) return { ok: false, error: "缺少 trade_id" };
    const amount = body["amount"] ?? null;
    const actual = body["actual_amount"] ?? null;
    if ((amount !== null && ((typeof amount !== "string" && typeof amount !== "number") || toMinorUnitsOrNull(amount) === null)) ||
        (status === 2 && amount === null)) {
      return { ok: false, error: "回调金额非法" };
    }
    if ((actual !== null && ((typeof actual !== "string" && typeof actual !== "number") || !/^\d+(?:\.\d{1,6})?$/.test(String(actual)) || !Number.isFinite(Number(actual)) || Number(actual) <= 0)) ||
        (status === 2 && actual === null)) {
      return { ok: false, error: "回调实付金额非法" };
    }
    return {
      ok: true,
      payload: {
        providerRef,
        orderNo,
        amount: amount as string | number | null,
        actualAmount: actual === null ? null : String(actual),
        status,
      },
    };
  },

  async cancelPayment(gateway, providerRef) {
    if (!gateway.apiBase || !gateway.token?.trim()) return { ok: false, message: "网关未配置，跳过撤销" };
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
      return { ok: false, message: `网关未受理撤销：HTTP ${res.status} ${json?.message ?? ""}`.trim() };
    } catch (err) {
      return {
        ok: false,
        message: `撤销请求失败：${err instanceof Error ? err.message : String(err)}`,
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
