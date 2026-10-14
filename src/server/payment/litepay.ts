import { normalizeHttpUrl } from "@/lib/http-url";
import { hmacHex, parseJsonObject, safeEqualHex, sha256Hex } from "@/lib/signature";
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
 * litepay 渠道（pay.9527.tr，Go 版交易所收款网关）。
 *
 * 契约（与 litepay `internal/security/hmac.go` + `api/*.go` 逐字对齐）：
 *
 * 1) 创建订单 `POST {api_base}/api/v1/orders`
 *    - 请求头：`X-LitePay-Key`（Access Key）、`X-LitePay-Timestamp`（**毫秒**）、
 *      `X-LitePay-Nonce`（随机串）、`X-LitePay-Signature`
 *    - 待签串：`METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)`（hex，HMAC-SHA256）
 *    - 响应：`{ code, message, data }`，`code === "OK"` 为成功；
 *      `data` 内含 `order_no / pay_address / pay_memo / amount / currency /
 *      network / expire_time`（**收款地址，不是收银台 URL**）
 *
 * 2) 到账回调 `POST {notify_url}`（litepay → 本站）
 *    - 请求头：`X-LitePay-Event`、`X-LitePay-Event-Id`、`X-LitePay-Timestamp`、
 *      `X-LitePay-Nonce`、`X-LitePay-Signature`
 *    - 待签串：`timestamp\nnonce\nevent_id\nSHA256(body)`（hex，HMAC-SHA256）
 *    - 业务体：`{ event_id, event_type, order_no, merchant_order_no, status,
 *      amount, paid_amount, paid_at, ... }`
 *
 * 与旧版 litepay 的差异（旧版有托管收银台 `cashier_url`）：
 * 新网关只返回**收款地址**，因此买家端由本站 `/pay/address` 页面自行展示
 * 地址/备注/金额，故 `paymentUrl` 指向站内页面而非网关。
 *
 * 币种口径：新网关按**加密货币**计价（每笔订单绑定一个充值地址）。
 * 本站商品以 USD 计价，故按 1:1 折算为 `coin`（默认 USDT），与旧 exchange
 * 渠道的 `asset + rate=1` 口径一致。
 */

export const LITEPAY_ADDRESS_PATH = "/pay/address";
export const DEFAULT_LITEPAY_COIN = "USDT";

/** 回调时间窗（毫秒）：网关每次投递都会用新时间戳重签，超出即视为重放/异常 */
export const LITEPAY_CALLBACK_WINDOW_MS = 5 * 60 * 1000;

export interface LitepayConfig {
  apiBase?: string;
  /** 商户 Access Key（litepay 管理台「商户」页生成） */
  accessKey?: string;
  secret?: string;
  /** LitePay 网关里实际启用的交易所账户。旧配置默认沿用当前生产账户 Binance。 */
  provider?: "binance" | "okx";
  /** 结算币种（加密货币），默认 USDT */
  coin?: string;
  /** 结算网络（如 TRC20 / TRON），留空由网关按币种默认网络选择 */
  network?: string;
}

/**
 * 解析配置。
 *
 * 兼容两种键名：`access_key`（新）与 `merchant_id`（既有生产数据与设置表单仍在用），
 * 避免为改一个键名而迁移线上配置。
 */
export function parseLitepayConfig(config: Record<string, unknown>): LitepayConfig {
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const provider = str(config["provider"])?.toLowerCase();
  return {
    apiBase: str(config["api_base"])?.replace(/\/+$/, ""),
    accessKey: str(config["access_key"]) ?? str(config["merchant_id"]),
    secret: str(config["secret"]),
    // 兼容已有生产配置：LitePay 当前只启用了 Binance 账户。
    provider: !provider || provider === "binance" ? "binance" : provider === "okx" ? "okx" : undefined,
    coin: str(config["coin"]),
    network: str(config["network"]),
  };
}

/** 本站收款信息页地址（买家跳转目标） */
export function litepayAddressUrl(orderNo: string): string {
  return `${LITEPAY_ADDRESS_PATH}?order_no=${encodeURIComponent(orderNo)}`;
}

/**
 * 商户请求待签串：`METHOD\nPATH\nTIMESTAMP\nNONCE\nSHA256(body)`。
 * 与网关 `security.CanonicalRequest` 一致（PATH 无 query，故无需规范化）。
 */
export function litepayMerchantSignString(
  method: string,
  path: string,
  timestamp: string,
  nonce: string,
  body: string
): string {
  return [method.toUpperCase(), path, timestamp, nonce, sha256Hex(body)].join("\n");
}

/** 回调待签串：`timestamp\nnonce\nevent_id\nSHA256(body)` */
export function litepayCallbackSignString(
  timestamp: string,
  nonce: string,
  eventId: string,
  rawBody: string
): string {
  return [timestamp, nonce, eventId, sha256Hex(rawBody)].join("\n");
}

/** 分 → 十进制金额字符串（纯 BigInt，避免浮点误差） */
export function centsToAmountString(cents: bigint): string {
  const neg = cents < 0n;
  const abs = neg ? -cents : cents;
  return `${neg ? "-" : ""}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

/** 生成 nonce（32 位十六进制随机串） */
function randomNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

interface LitepayOrderData {
  order_no?: string;
  merchant_order_no?: string;
  status?: string;
  provider?: string;
  currency?: string;
  network?: string;
  amount?: string;
  paid_amount?: string;
  pay_address?: string;
  pay_memo?: string;
  expire_time?: number;
  created_at?: number;
  paid_at?: number;
}

interface LitepayEnvelope {
  code?: string;
  message?: string;
  data?: LitepayOrderData;
}

/** 收款信息（供 `/pay/address` 页面渲染；来源为落库的网关响应快照） */
export interface LitepayPaymentTarget {
  address: string;
  memo: string;
  amount: string | null;
  currency: string | null;
  network: string | null;
  expiresAtMs: number | null;
}

/**
 * 从支付尝试落库的原始响应中提取收款信息（纯函数，便于单测）。
 * 非 litepay 结构或缺少地址时返回 null。
 */
export function parseLitepayPaymentTarget(raw: unknown): LitepayPaymentTarget | null {
  let parsed: unknown = raw;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const data = parsed as LitepayOrderData;
  const address = typeof data.pay_address === "string" ? data.pay_address.trim() : "";
  if (!address) return null;
  return {
    address,
    memo: typeof data.pay_memo === "string" ? data.pay_memo.trim() : "",
    amount: typeof data.amount === "string" && data.amount !== "" ? data.amount : null,
    currency: typeof data.currency === "string" && data.currency !== "" ? data.currency : null,
    network: typeof data.network === "string" && data.network !== "" ? data.network : null,
    expiresAtMs:
      typeof data.expire_time === "number" && Number.isFinite(data.expire_time)
        ? data.expire_time
        : null,
  };
}

/** 事件类型 → 本站 NotifyStatus（1 待支付 / 2 成功 / 3 超时关闭） */
export function mapLitepayEventToStatus(eventType: string): NotifyStatus | null {
  switch (eventType) {
    case "order.paid":
      return 2;
    case "order.expired":
    case "order.closed":
    case "order.failed":
      return 3;
    default:
      return null;
  }
}

export function litepayProvider(rawConfig: Record<string, unknown>): PaymentProvider {
  const config = parseLitepayConfig(rawConfig);

  return {
    name: "litepay",

    async createPayment(input: CreatePaymentInput): Promise<CreatedPayment> {
      if (!config.apiBase || !config.accessKey || !config.secret) {
        throw new Error("litepay 未配置：请在后台填写网关地址与商户 Access Key / Secret");
      }
      if (!config.provider) {
        throw new Error("litepay provider 配置无效：请选择 binance 或 okx");
      }
      const coin = config.coin ?? DEFAULT_LITEPAY_COIN;
      const path = "/api/v1/orders";
      const body = JSON.stringify({
        merchant_order_no: input.orderNo,
        amount: centsToAmountString(input.amountCents),
        currency: coin,
        ...(config.network ? { network: config.network } : {}),
        provider: config.provider,
        description: input.subject,
        callback_url: input.notifyUrl,
        ...(input.timeoutSeconds ? { expire_in: Math.trunc(input.timeoutSeconds) } : {}),
      });
      const timestamp = String(Date.now());
      const nonce = randomNonce();
      const signature = hmacHex(
        config.secret,
        litepayMerchantSignString("POST", path, timestamp, nonce, body)
      );

      let res: Response;
      try {
        res = await fetch(`${config.apiBase}${path}`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "X-LitePay-Key": config.accessKey,
            "X-LitePay-Timestamp": timestamp,
            "X-LitePay-Nonce": nonce,
            "X-LitePay-Signature": signature,
          },
          body,
          signal: AbortSignal.timeout(15_000),
        });
      } catch (err) {
        // 网络层失败/超时：结果未知（网关可能已建单）
        throw new PaymentCreationError(
          "unknown",
          `litepay 创建订单请求失败: ${err instanceof Error ? err.message : String(err)}`
        );
      }

      const text = await res.text();

      // 4xx = 网关明确拒绝（鉴权失败 / 参数错误 / 无可用户），未建单 → 可安全回补库存
      if (res.status >= 400 && res.status < 500) {
        throw new PaymentCreationError(
          "rejected",
          `litepay 创建订单被拒绝 HTTP ${res.status}: ${text.slice(0, 200)}`
        );
      }
      // 5xx = 服务端故障，结果未知
      if (!res.ok) {
        throw new PaymentCreationError(
          "unknown",
          `litepay 创建订单 HTTP ${res.status}: ${text.slice(0, 200)}`
        );
      }

      let envelope: LitepayEnvelope;
      try {
        envelope = JSON.parse(text) as LitepayEnvelope;
      } catch {
        // 200 但报文不可解析：不能断言未建单
        throw new PaymentCreationError("unknown", `litepay 创建订单响应解析失败: ${text.slice(0, 200)}`);
      }

      const data = envelope.data;
      if (envelope.code !== "OK" || !data?.order_no || !data.pay_address) {
        throw new PaymentCreationError(
          "unknown",
          `litepay 创建订单响应异常: ${envelope.message ?? text.slice(0, 200)}`
        );
      }

      return {
        provider: "litepay",
        // trade_id 用网关订单号：回调按 order_no 归属该笔支付尝试
        tradeId: data.order_no,
        // 新网关不提供托管收银台，买家端由本站页面展示收款地址
        paymentUrl: litepayAddressUrl(input.orderNo),
        expectedActualAmount: data.amount ?? null,
        expirationTime:
          typeof data.expire_time === "number" && data.expire_time > 0
            ? new Date(data.expire_time)
            : null,
        raw: data,
      };
    },

    verifyNotify(rawBody: string, headers?: Headers): NotifyVerification {
      if (!config.secret) return { ok: false, error: "litepay secret 未配置" };

      const timestamp = headers?.get("x-litepay-timestamp") ?? "";
      const nonce = headers?.get("x-litepay-nonce") ?? "";
      const eventId = headers?.get("x-litepay-event-id") ?? "";
      const given = headers?.get("x-litepay-signature") ?? "";
      if (!timestamp || !nonce || !eventId || !given) {
        return { ok: false, error: "回调签名请求头缺失" };
      }

      // 时间窗：网关每次投递都用新时间戳重签，超出窗口说明报文陈旧/被重放
      const tsMs = Number(timestamp);
      if (!Number.isFinite(tsMs) || Math.abs(Date.now() - tsMs) > LITEPAY_CALLBACK_WINDOW_MS) {
        return { ok: false, error: "回调时间戳超出允许窗口" };
      }

      const expected = hmacHex(
        config.secret,
        litepayCallbackSignString(timestamp, nonce, eventId, rawBody)
      );
      if (!safeEqualHex(expected, given)) {
        return { ok: false, error: "回调签名校验失败" };
      }

      // 验签通过后才解析业务字段
      const parsed = parseJsonObject(rawBody);
      if (!parsed.ok) return { ok: false, error: parsed.error };
      const body = parsed.value;

      const eventType = String(body["event_type"] ?? "");
      const status = mapLitepayEventToStatus(eventType);
      if (status === null) {
        // 未知事件：记录但不重试（与既有语义一致）
        return { ok: false, error: `未知事件: ${eventType}` };
      }

      const merchantOrderNo = String(body["merchant_order_no"] ?? "").trim();
      if (!merchantOrderNo) return { ok: false, error: "缺少 merchant_order_no" };

      const gatewayOrderNo = body["order_no"] != null ? String(body["order_no"]) : null;
      const paidAtRaw = Number(body["paid_at"]);
      const amountRaw = body["amount"];
      const paidAmountRaw = body["paid_amount"];

      const payload: NotifyPayload = {
        provider: "litepay",
        orderNo: merchantOrderNo,
        // 与 createPayment 返回的 tradeId 同源（网关订单号），用于归属判定
        tradeId: gatewayOrderNo,
        // 本站以 USD 计价、按 1:1 折算为加密货币，故 amount 即订单金额
        amount: amountRaw == null ? null : String(amountRaw),
        actualAmount: paidAmountRaw == null ? null : String(paidAmountRaw),
        status,
        blockTxnId: null,
      };
      void paidAtRaw;
      return { ok: true, payload };
    },
  };
}

/** 供页面层构造绝对地址（保留相对路径给前端跳转） */
export function litepayAddressAbsoluteUrl(siteUrl: string, orderNo: string): string {
  return normalizeHttpUrl(litepayAddressUrl(orderNo), siteUrl) ?? "";
}
