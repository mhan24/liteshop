import { normalizeHttpUrl } from "@/lib/http-url";
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
 *   不传 trade_type，由收银台让买家自选收款平台与币种
 *   （pay.9527.tr 收银台：先选 Binance / OKX，再选 USDT / USDC，
 *   按页面显示的精确金额发起交易所站内转账）
 * - 可选参数：currencies（收银台币种限制，如 "USDT,USDC"）、
 *   reselect（允许买家在收银台重选平台/币种，网关示例固定 true）
 * - 回调 POST JSON：amount=float64、actual_amount=string、status=int(1/2/3)
 * - 商户应答：HTTP 2xx + 正文精确为 success/ok（不区分大小写，
 *   本站固定应答 "success"；对 status=3 过期通知同样回 2xx success）
 * - 商户主动关单时调用 POST {api_base}/api/v1/order/cancel-transaction，
 *   网关随即停止确认到账、不再发送过期通知
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
  /** 收银台币种限制（逗号分隔，如 "USDT,USDC"；空 = 不限制） */
  currencies?: string;
  /** 允许买家在收银台重选平台/币种（pay.9527.tr 文档示例固定 true，缺省 true） */
  reselect?: boolean;
}

/**
 * 归一化币种限制：按逗号/空白拆分 → 去空 → 大写 → 去重 → 逗号拼接。
 * 无有效项时返回 undefined（表示不限制）。
 */
export function normalizeBepusdtCurrencies(raw: string | undefined): string | undefined {
  const tokens = (raw ?? "")
    .split(/[,\s，、]+/)
    .map((t) => t.trim().toUpperCase())
    .filter((t) => t !== "");
  const unique = [...new Set(tokens)].slice(0, 16);
  return unique.length > 0 ? unique.join(",") : undefined;
}

export function parseBepusdtConfig(config: Record<string, unknown>): BepusdtConfig {
  const str = (v: unknown) => (typeof v === "string" && v.trim() !== "" ? v.trim() : undefined);
  const num = (v: unknown) => {
    const n = typeof v === "number" ? v : Number(v);
    return Number.isFinite(n) && n > 0 ? n : undefined;
  };
  const rawTimeout = num(config["timeout_seconds"]);
  // 表单提交 "on"、字符串 "true"/"false" 与布尔值统一归一化；缺省 true（与网关示例一致）
  const rawReselect = config["reselect"];
  const reselect =
    rawReselect == null
      ? undefined
      : rawReselect === false ||
          rawReselect === 0 ||
          rawReselect === "false" ||
          rawReselect === "0" ||
          rawReselect === "off"
        ? false
        : true;
  return {
    // 仅接受 http/https：该值最终会拼进 fetch()，放任其它协议（file:、data: 等）
    // 会形成 SSRF/本地文件读取面。后台保存时已校验，这里再做一道纵深防御。
    apiBase: normalizeBepusdtApiBase(str(config["api_base"])),
    token: str(config["token"]),
    // 越界/缺失一律钳制，避免与网关实际过期时间脱节
    timeoutSeconds: rawTimeout == null ? undefined : clampBepusdtTimeout(rawTimeout),
    currencies: normalizeBepusdtCurrencies(str(config["currencies"])),
    reselect,
  };
}

/** 校验并归一化 API 地址；非法协议/不可解析一律返回 undefined（视同未配置） */
export function normalizeBepusdtApiBase(raw: string | undefined): string | undefined {
  const safe = raw && normalizeHttpUrl(raw);
  if (!safe) return undefined;
  const url = new URL(safe);
  if (url.search || url.hash) return undefined;
  const host = url.hostname.toLowerCase();
  // 内网网关是受支持的管理员配置；云元数据地址不应作为支付端点。
  if (/^169\.254\./.test(host) || /^\[fe[89ab]/.test(host) || /^\[::ffff:a9fe:/.test(host) ||
      ["metadata.google.internal", "instance-data.ec2.internal", "100.100.100.200"].includes(host)) return undefined;
  const allowed = process.env.BEPUSDT_ALLOWED_ORIGINS?.split(",").map(v => normalizeHttpUrl(v.trim()))
    .filter((v): v is string => !!v).map(v => new URL(v).origin);
  if (process.env.BEPUSDT_ALLOWED_ORIGINS && !allowed?.includes(url.origin)) return undefined;
  return safe.replace(/\/+$/, "");
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
        // 收银台模式：允许买家重选平台/币种（pay.9527.tr 文档示例值 true）
        reselect: config.reselect ?? true,
        // 币种限制（如 "USDT,USDC"）；未配置则不下发，由收银台展示全部可用币种
        ...(config.currencies ? { currencies: config.currencies } : {}),
      };
      const signed = { ...body, signature: epusdtSign(body, config.token) };

      const res = await fetch(`${config.apiBase}/api/v1/order/create-order`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(signed),
        signal: AbortSignal.timeout(15_000),
        redirect: "error",
      });
      if (!res.ok) {
        // 结果分类（决定上层是否补偿关单、释放库存）：
        //
        // unknown = 「无法证明网关未建单」→ 保留订单待对账
        // rejected = 「明确是本次请求被拒」→ 可安全关单
        //
        // - 5xx：网关可能已建单（写完库后报错、前置代理故障）→ unknown
        // - 408 / 429：请求超时或被限流。上游可能**已接受**该请求，
        //   只是由中间层返回了这类错误 → 不能证明未建单 → unknown
        // - 其它 4xx（400 参数错误、401 鉴权失败、404 等）：
        //   是明确的请求侧拒绝 → rejected
        const AMBIGUOUS = res.status >= 500 || res.status === 408 || res.status === 429;
        throw new PaymentCreationError(
          AMBIGUOUS ? "unknown" : "rejected",
          `bepusdt 创建订单 HTTP ${res.status}`
        );
      }
      let json: unknown;
      try {
        json = await res.json();
      } catch {
        // 响应体无法解析：网关可能已建单，但回包损坏 → unknown
        throw new PaymentCreationError("unknown", "bepusdt 创建订单响应无法解析");
      }
      // 结构校验：必须是**对象**（非 null、非数组、非标量）。
      //
      // 注意 `res.json()` 能成功解析字面量 `null`（和 `"[]"`、`"123"`），
      // 但随后访问 `json.data` 会抛 TypeError。该异常既不是
      // PaymentCreationError，也不匹配上层 isUnknownResultError() 的
      // 网络错误特征（"Cannot read properties of null"），
      // 因此会被当成"明确失败"而走补偿关单、释放库存。
      // 而 HTTP 200 + 合法 JSON 并不能证明网关未建单 —— 必须按 unknown 处理。
      if (typeof json !== "object" || json === null || Array.isArray(json)) {
        throw new PaymentCreationError(
          "unknown",
          `bepusdt 创建订单响应结构异常: ${JSON.stringify(json)?.slice(0, 200) ?? "null"}`
        );
      }
      const parsed = json as CreateOrderResponse;
      const data = parsed.data;
      // 关键字段**类型**校验：必须是**非空字符串**。
      //
      // 仅用 `!data.trade_id` 判断不够 —— 对象/数组/数字都是 truthy，
      // 会通过检查后被当成字符串写入 SQLite 文本列。
      // 绑定失败发生在 createPayment() 返回**之后**（订单回写阶段），
      // 已超出 createOrder() 的 try/catch 范围 → 订单停留在 pending、
      // 无有效期，却已占用库存（人工商品）或卡密（自动商品）。
      if (
        typeof data?.trade_id !== "string" ||
        data.trade_id.trim() === "" ||
        typeof data?.payment_url !== "string" ||
        data.payment_url.trim() === ""
      ) {
        // HTTP 200 但缺少 trade_id / payment_url —— **不能**断定未建单。
        // 网关可能已创建交易，只是响应数据不完整（异常回包、代理截断等）。
        // 若按 rejected 处理，上层会补偿关单并释放库存，
        // 而网关侧交易仍有效 → 买家付款后无法履约。
        // 因此归为 unknown：保留订单进入待对账，由人工核对。
        //
        // 例外：报文里带了明确的业务失败信息（status_code >= 400 且有 message），
        // 说明是网关拒绝本次请求，可按 rejected 处理。
        const bizRejected =
          typeof parsed.status_code === "number" &&
          parsed.status_code >= 400 &&
          parsed.message != null;
        throw new PaymentCreationError(
          bizRejected ? "rejected" : "unknown",
          `bepusdt 创建订单响应不完整（缺 ${
            !data?.trade_id ? "trade_id" : "payment_url"
          }）: ${parsed.message ?? JSON.stringify(parsed).slice(0, 200)}`
        );
      }
      const paymentUrl = normalizeHttpUrl(data.payment_url, config.apiBase);
      if (!paymentUrl) throw new PaymentCreationError("unknown", "bepusdt 收银台地址协议或格式不安全，订单保留待对账");
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
        paymentUrl,
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

    /**
     * 商户侧主动关单 → 通知网关撤销未到账交易（best-effort）。
     * 网关受理后停止确认到账、不再发送过期通知；对已结束的交易返回
     * 业务层 status_code>=400（如「订单不存在」），同样视为未受理，
     * 由调用方记日志即可——本地关单语义不受影响。
     */
    async cancelPayment(tradeId: string): Promise<{ ok: boolean; message: string }> {
      if (!config.apiBase || !config.token) {
        return { ok: false, message: "bepusdt 未配置，跳过网关取消" };
      }
      const id = tradeId.trim();
      if (!id) return { ok: false, message: "缺少 trade_id，跳过网关取消" };
      const body = { trade_id: id };
      try {
        const res = await fetch(`${config.apiBase}/api/v1/order/cancel-transaction`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ...body, signature: epusdtSign(body, config.token) }),
          signal: AbortSignal.timeout(15_000),
          redirect: "error",
        });
        const json = (await res.json().catch(() => null)) as
          | { status_code?: number; message?: string }
          | null;
        if (res.ok && typeof json?.status_code === "number" && json.status_code < 400) {
          return { ok: true, message: "网关已受理取消交易" };
        }
        return {
          ok: false,
          message: `网关未受理取消：HTTP ${res.status} status_code=${json?.status_code ?? "?"} ${json?.message ?? ""}`.trim(),
        };
      } catch (err) {
        return {
          ok: false,
          message: `网关取消请求失败: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
    },
  };
}
