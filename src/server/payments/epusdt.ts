import { normalizeHttpUrl } from "@/lib/http-url";
import { epusdtSign, parseJsonObject, safeEqualHex } from "@/lib/epusdt";
import type {
  CreateOutcome,
  CreatePaymentInput,
  NotifyVerification,
  PaymentAdapter,
} from "./types";
import { fiatAmountForGateway } from "./types";

/**
 * BEpusdt 兼容收银台适配器（覆盖 LitePay pay.9527.tr 与自建 BEpusdt）。
 *
 * 契约（2026-10 经 pay.9527.tr 实测核实）：
 * - 下单 POST {api_base}/api/v1/order/create-order，MD5 签名（见 lib/epusdt），
 *   可选 currencies / reselect / timeout（[180,3600] 秒，缺省 600）
 * - 响应 data：trade_id / payment_url / expiration_time（剩余秒）/ actual_amount / amount
 * - 回调 POST JSON：trade_id / order_id / amount / actual_amount / token / status(1|2|3) / signature
 * - 商户应答：HTTP 2xx + 正文精确 success/ok（不区分大小写）；明确 fail 判为投递失败重试
 * - 商户关单：POST {api_base}/api/v1/order/cancel-transaction {trade_id, signature}
 */

interface CreateOrderResponse {
  status_code?: number;
  message?: string;
  data?: {
    trade_id?: string;
    payment_url?: string;
    expiration_time?: number | string;
    actual_amount?: string | number;
    amount?: string | number;
  };
}

export function clampTimeout(sec: number | undefined): number {
  if (sec == null || !Number.isFinite(sec)) return 600;
  const n = Math.trunc(sec);
  return Math.min(Math.max(n, 180), 3600);
}

function normalizeApiBase(raw: string | null | undefined): string | null {
  const origin = normalizeHttpUrl(raw ?? undefined);
  return origin ? origin.replace(/\/+$/, "") : null;
}

export const epusdtAdapter: PaymentAdapter = {
  type: "epusdt",

  async createPayment(channel, input: CreatePaymentInput): Promise<CreateOutcome> {
    const apiBase = normalizeApiBase(channel.apiBase);
    if (!apiBase || !channel.token) {
      return { kind: "rejected", message: `${channel.key} 渠道未配置网关地址或令牌` };
    }
    const timeout = clampTimeout(channel.timeoutSeconds);
    const body: Record<string, unknown> = {
      order_id: input.orderNo,
      notify_url: input.notifyUrl,
      redirect_url: input.redirectUrl,
      amount: fiatAmountForGateway(input.amountMinor, input.currency),
      fiat: input.currency,
      name: input.subject,
      timeout,
      reselect: channel.reselect,
      ...(channel.currencies ? { currencies: channel.currencies } : {}),
    };
    const signed = { ...body, signature: epusdtSign(body, channel.token) };

    let res: Response;
    try {
      res = await fetch(`${apiBase}/api/v1/order/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
    } catch (err) {
      return { kind: "unknown", message: `创建订单请求失败: ${err instanceof Error ? err.message : String(err)}` };
    }

    // 5xx/408/429 无法证明未建单 → unknown；其它 4xx 明确拒绝
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
    const data = parsed.data;
    if (typeof data?.trade_id !== "string" || data.trade_id.trim() === "" || typeof data?.payment_url !== "string" || data.payment_url.trim() === "") {
      // HTTP 200 但缺关键数据：不能证明未建单 → 未知
      const bizRejected =
        typeof parsed.status_code === "number" && parsed.status_code >= 400 && parsed.message != null;
      return {
        kind: bizRejected ? "rejected" : "unknown",
        message: `创建订单响应不完整: ${parsed.message ?? JSON.stringify(parsed).slice(0, 200)}`,
      };
    }
    const paymentUrl = normalizeHttpUrl(data.payment_url);
    if (!paymentUrl) {
      return { kind: "unknown", message: "收银台地址协议或格式不安全，订单保留待对账" };
    }
    // expiration_time 是「剩余秒数」而非 Unix 时间戳
    const expSeconds = typeof data.expiration_time === "string" ? Number(data.expiration_time) : data.expiration_time;
    const hasExpiry = typeof expSeconds === "number" && Number.isFinite(expSeconds) && expSeconds > 0;
    return {
      kind: "created",
      payment: {
        providerRef: data.trade_id,
        paymentUrl,
        expectedAmount:
          data.actual_amount != null && data.actual_amount !== "" ? String(data.actual_amount) : null,
        expiresAt: hasExpiry ? new Date(Date.now() + (expSeconds as number) * 1000) : new Date(Date.now() + timeout * 1000),
        raw: data,
      },
    };
  },

  verifyNotify(channel, rawBody): NotifyVerification {
    if (!channel.token) return { ok: false, error: "渠道令牌未配置" };
    const parsed = parseJsonObject(rawBody);
    if (!parsed.ok) return { ok: false, error: parsed.error };
    const body = parsed.value;
    const given = body["signature"];
    if (typeof given !== "string" || given === "") return { ok: false, error: "缺少签名" };
    if (!safeEqualHex(epusdtSign(body, channel.token), given)) {
      return { ok: false, error: "签名校验失败" };
    }
    const status = Number(body["status"]);
    if (![1, 2, 3].includes(status)) return { ok: false, error: `非法 status: ${String(body["status"])}` };
    const orderNo = String(body["order_id"] ?? "");
    if (!orderNo) return { ok: false, error: "缺少 order_id" };
    const providerRef = body["trade_id"] != null ? String(body["trade_id"]) : "";
    if (!providerRef) return { ok: false, error: "缺少 trade_id" };
    return {
      ok: true,
      payload: {
        providerRef,
        orderNo,
        amount: (body["amount"] ?? null) as string | number | null,
        actualAmount: body["actual_amount"] != null ? String(body["actual_amount"]) : null,
        status: status as 1 | 2 | 3,
      },
    };
  },

  async cancelPayment(channel, providerRef) {
    const apiBase = normalizeApiBase(channel.apiBase);
    if (!apiBase || !channel.token) return { ok: false, message: "渠道未配置，跳过网关取消" };
    const body = { trade_id: providerRef };
    try {
      const res = await fetch(`${apiBase}/api/v1/order/cancel-transaction`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...body, signature: epusdtSign(body, channel.token) }),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      const json = (await res.json().catch(() => null)) as { status_code?: number; message?: string } | null;
      if (res.ok && typeof json?.status_code === "number" && json.status_code < 400) {
        return { ok: true, message: "网关已受理取消" };
      }
      return { ok: false, message: `网关未受理取消: HTTP ${res.status} ${json?.message ?? ""}`.trim() };
    } catch (err) {
      return { ok: false, message: `网关取消请求失败: ${err instanceof Error ? err.message : String(err)}` };
    }
  },
};
