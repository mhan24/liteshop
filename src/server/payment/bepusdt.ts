import { minorUnitsToNumber } from "@/lib/money";
import { epusdtSign, epusdtVerify, parseJsonObject } from "@/lib/signature";
import { PaymentCreationError } from "./index";
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

/**
 * 交易超时边界，与网关 CalcTradeExpiredAt 完全对齐（以网关为准）：
 *   // app/model/order.go —— 最小180，最大3600，默认1200
 *   func CalcTradeExpiredAt(sec int64) time.Time {
 *     if sec >= 180 && sec <= 3600 { return time.Now().Add(sec * time.Second) }
 *     return time.Now().Add(GetK(PaymentTimeout) * time.Second)
 *   }
 * 传超出 [180, 3600] 的值网关会静默忽略并回落到它自己的 PaymentTimeout(默认1200)，
 * 导致「我方展示的有效期」与「网关实际过期」不一致；因此钳制在闭区间内。
 */
export const BEPUSDT_TIMEOUT_MIN = 180;
export const BEPUSDT_TIMEOUT_MAX = 3600;
/** 网关 GetK(PaymentTimeout) 的默认值（我们未传有效值时网关会采用） */
export const BEPUSDT_TIMEOUT_DEFAULT = 1200;

/** 将任意输入钳制到网关可接受的 [180, 3600] 区间 */
export function clampBepusdtTimeout(sec: number | undefined): number {
  if (sec == null || !Number.isFinite(sec)) return BEPUSDT_TIMEOUT_DEFAULT;
  const n = Math.trunc(sec);
  if (n < BEPUSDT_TIMEOUT_MIN) return BEPUSDT_TIMEOUT_MIN;
  if (n > BEPUSDT_TIMEOUT_MAX) return BEPUSDT_TIMEOUT_MAX;
  return n;
}

export interface BepusdtConfig {
  apiBase?: string;
  token?: string;
  timeoutSeconds?: number;
}

export function parseBepusdtConfig(config: Record<string, unknown>): BepusdtConfig {
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const rawTimeout = num(config["timeout_seconds"]);
  return {
    // 仅接受 http/https：该值最终会拼进 fetch()，放任其它协议（file:、data: 等）
    // 会形成 SSRF/本地文件读取面。后台保存时已校验，这里再做一道纵深防御。
    apiBase: normalizeApiBase(str(config["api_base"])),
    token: str(config["token"]),
    // 越界/缺失一律钳制，避免与网关实际过期时间脱节
    timeoutSeconds: rawTimeout == null ? undefined : clampBepusdtTimeout(rawTimeout),
  };
}

/** 校验并归一化 API 地址；非法协议/不可解析一律返回 undefined（视同未配置） */
function normalizeApiBase(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const trimmed = raw.replace(/\/+$/, "");
  try {
    const u = new URL(trimmed);
    if (u.protocol !== "http:" && u.protocol !== "https:") return undefined;
    return trimmed;
  } catch {
    return undefined;
  }
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
      // 钳制到网关可接受区间（网关对越界值会静默回落到自己的默认 1200s）
      const timeout = clampBepusdtTimeout(input.timeoutSeconds ?? config.timeoutSeconds);
      const body: Record<string, unknown> = {
        order_id: input.orderNo,
        notify_url: input.notifyUrl,
        redirect_url: input.redirectUrl,
        // 按币种输出：JPY 直接给日元数，不除以 100
        amount: minorUnitsToNumber(input.amountCents, input.currency),
        // fiat 跟随订单币种（站点统一币种：USD/CNY/EUR/GBP/JPY）
        fiat: input.currency,
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
        // 5xx 表示网关**可能已经建单**（例如写完库后返回失败、或前置代理报错），
        // 因此归为 unknown：不得据此关单释放库存。
        // 4xx 是明确的请求侧拒绝（参数/鉴权），可以安全判定为未建单。
        const outcome = res.status >= 500 ? "unknown" : "rejected";
        throw new PaymentCreationError(
          outcome,
          `bepusdt 创建订单 HTTP ${res.status}`
        );
      }
      let json: CreateOrderResponse;
      try {
        json = (await res.json()) as CreateOrderResponse;
      } catch {
        // 响应体无法解析：网关可能已建单，但回包损坏 → unknown
        throw new PaymentCreationError("unknown", "bepusdt 创建订单响应无法解析");
      }
      const data = json.data;
      if (!data?.trade_id || !data.payment_url) {
        // 网关明确回了一个「业务失败」结构（有 status_code/message），
        // 视为 rejected：它没有给出交易号，即未建单。
        throw new PaymentCreationError(
          "rejected",
          `bepusdt 创建订单失败: ${json.message ?? JSON.stringify(json).slice(0, 200)}`
        );
      }
      // 注意：bepusdt 的 expiration_time 是「剩余有效期（秒）」，不是 Unix 时间戳。
      // 网关源码 app/handler/epusdt/epusdt.go：
      //   "expiration_time": uint64(order.ExpiredAt.Sub(time.Now()).Seconds())
      // 因此必须用 now + 剩余秒数计算绝对过期时刻，否则会落成 1970 纪元时间。
      const expSeconds =
        typeof data.expiration_time === "string" ? Number(data.expiration_time) : data.expiration_time;
      const hasExpiry = Number.isFinite(expSeconds) && (expSeconds as number) > 0;
      return {
        provider: "bepusdt",
        tradeId: data.trade_id,
        paymentUrl: data.payment_url,
        expectedActualAmount: data.actual_amount != null ? String(data.actual_amount) : null,
        expirationTime: hasExpiry
          ? new Date(Date.now() + (expSeconds as number) * 1000)
          : // 网关未返回有效期时兜底为本次请求的 timeout，避免订单永不过期
            new Date(Date.now() + timeout * 1000),
        raw: data,
      };
    },

    verifyNotify(rawBody: string): NotifyVerification {
      const parsed = parseJsonObject(rawBody);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const body = parsed.value;
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
