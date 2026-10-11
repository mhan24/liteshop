import { centsToNumber } from "@/lib/money";
import { epusdtSign, epusdtVerify } from "@/lib/signature";
import type {
  CreatePaymentInput,
  CreatedPayment,
  NotifyPayload,
  NotifyStatus,
  NotifyVerification,
  PaymentProvider,
} from "./index";

/**
 * bepusdt 渠道（字段与算法均经网关源码核实，见 PLAN §5）：
 * - 创建订单走「收银台」接口 POST {api_base}/api/v1/order/create-order：
 *   不传 trade_type，由 bepusdt 收银台让买家自选币种/网络（网关文档 §3）
 * - 回调 POST JSON：amount=float64、actual_amount=string、status=int(1/2/3)
 * - 商户应答：HTTP 200 + 含 success/ok（本站固定应答 "success"）
 */

export interface BepusdtConfig {
  apiBase?: string;
  token?: string;
  fiat?: string;
  timeoutSeconds?: number;
}

export function parseBepusdtConfig(config: Record<string, unknown>): BepusdtConfig {
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  return {
    apiBase: str(config["api_base"])?.replace(/\/+$/, ""),
    token: str(config["token"]),
    fiat: str(config["fiat"]) ?? "CNY",
    timeoutSeconds: num(config["timeout_seconds"]),
  };
}

interface CreateOrderResponse {
  status_code?: number;
  message?: string;
  data?: {
    fiat?: string;
    trade_id?: string;
    order_id?: string;
    amount?: number;
    actual_amount?: string | number;
    status?: number;
    token?: string;
    expiration_time?: number | string;
    payment_url?: string;
    reselect?: boolean;
  };
  [k: string]: unknown;
}

export function bepusdtProvider(rawConfig: Record<string, unknown>): PaymentProvider {
  const config = parseBepusdtConfig(rawConfig);

  return {
    name: "bepusdt",

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      if (!config.apiBase || !config.token) {
        throw new Error("bepusdt 未配置：请在后台设置 api_base 与 token");
      }
      // create-order（收银台）超时最低 180 秒
      const timeout = Math.max(180, input.timeoutSeconds ?? config.timeoutSeconds ?? 600);
      const body: Record<string, unknown> = {
        order_id: input.orderNo,
        notify_url: input.notifyUrl,
        redirect_url: input.redirectUrl,
        amount: centsToNumber(input.amountCents),
        fiat: config.fiat,
        name: input.subject,
        timeout,
      };
      const signed = { ...body, signature: epusdtSign(body, config.token) };

      const res = await fetch(`${config.apiBase}/api/v1/order/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
        signal: AbortSignal.timeout(15_000),
      });
      if (!res.ok) {
        throw new Error(`bepusdt 创建订单 HTTP ${res.status}`);
      }
      const json = (await res.json()) as CreateOrderResponse;
      const data = json.data;
      if (!data?.trade_id || !data.payment_url) {
        throw new Error(`bepusdt 创建订单失败: ${json.message ?? JSON.stringify(json).slice(0, 200)}`);
      }
      const expSeconds = typeof data.expiration_time === "string" ? Number(data.expiration_time) : data.expiration_time;
      return {
        provider: "bepusdt",
        tradeId: data.trade_id,
        paymentUrl: data.payment_url,
        expectedActualAmount: data.actual_amount != null ? String(data.actual_amount) : null,
        expirationTime:
          Number.isFinite(expSeconds) && (expSeconds as number) > 0
            ? new Date((expSeconds as number) * 1000)
            : null,
        raw: data,
      };
    },

    verifyNotify(rawBody: string): NotifyVerification {
      let body: Record<string, unknown>;
      try {
        body = JSON.parse(rawBody) as Record<string, unknown>;
      } catch {
        return { ok: false, error: "JSON 解析失败" };
      }
      if (!config.token) return { ok: false, error: "bepusdt token 未配置" };
      if (!epusdtVerify(body, config.token)) {
        return { ok: false, error: "签名校验失败" };
      }
      const status = Number(body["status"]);
      if (![1, 2, 3].includes(status)) {
        return { ok: false, error: `非法 status: ${String(body["status"])}` };
      }
      const orderNo = String(body["order_id"] ?? "");
      if (!orderNo) return { ok: false, error: "缺少 order_id" };
      const payload: NotifyPayload = {
        provider: "bepusdt",
        orderNo,
        tradeId: body["trade_id"] != null ? String(body["trade_id"]) : null,
        amount: (body["amount"] ?? null) as string | number | null,
        actualAmount: body["actual_amount"] != null ? String(body["actual_amount"]) : null,
        status: status as NotifyStatus,
        blockTxnId: body["block_transaction_id"] != null ? String(body["block_transaction_id"]) : null,
      };
      return { ok: true, payload };
    },
  };
}
