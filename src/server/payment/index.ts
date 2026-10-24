import { getPaymentConfig } from "@/server/settings";
import { litepayProvider } from "./litepay";
import { bepusdtProvider } from "./bepusdt";
import { mockProvider } from "./mock";

/**
 * PaymentProvider 接口（PLAN §9 Engineering Constraints）：
 * 所有支付渠道必须实现本接口；页面层/API Route 不得直接对接渠道。
 */

export interface CreatePaymentInput {
  orderNo: string;
  amountCents: bigint;
  currency: string;
  /** 商品名（收银台展示） */
  subject: string;
  notifyUrl: string;
  redirectUrl: string;
  timeoutSeconds?: number;
}

export interface CreatedPayment {
  provider: string;
  tradeId: string | null;
  paymentUrl: string;
  /** 渠道返回的应付加密货币数量快照（对账用，原样字符串） */
  expectedActualAmount: string | null;
  expirationTime: Date | null;
  raw: unknown;
}

export type NotifyStatus = 1 | 2 | 3;

export interface NotifyPayload {
  provider: string;
  orderNo: string;
  tradeId: string | null;
  /** 原始法币金额（字符串/数字原样保存，转分在 fulfill 层用 toCents 完成） */
  amount: string | number | null;
  actualAmount: string | null;
  status: NotifyStatus;
  blockTxnId: string | null;
}

export interface NotifyVerification {
  ok: boolean;
  payload?: NotifyPayload;
  error?: string;
}

export interface PaymentProvider {
  readonly name: string;
  createPayment(input: CreatePaymentInput): Promise<CreatedPayment>;
  /** 验签 + 字段归一化；验签失败 ok=false（调用方应答 success 以终止重试并记录日志） */
  verifyNotify(rawBody: string, headers?: Headers): NotifyVerification;
  /**
   * 商户侧主动关单时通知网关撤销未到账交易（可选，网关型渠道实现）。
   * best-effort：失败不得阻断本地关单——最坏情况是网关随后推送成功回调，
   * 走既有的「异常到账」人工核对路径，不会重复发货。
   */
  cancelPayment?(tradeId: string): Promise<{ ok: boolean; message: string }>;
}

export class PaymentError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/**
 * 支付创建的结果分类。
 *
 * - confirmed：网关明确返回了交易（拿到了 trade_id）
 * - rejected ：网关**明确拒绝**（业务参数错误、鉴权失败等）——确定没有建单
 * - unknown  ：结果未知（超时、连接中断、5xx）——**可能已经建单**
 *
 * 这个区分直接决定能否安全释放库存：只有 rejected 才能关单回补；
 * unknown 必须保留订单并对账，否则会出现「网关有支付地址、商店已释放卡密」，
 * 买家付款后无法履约（资损）。
 */
export type PaymentCreationOutcome = "confirmed" | "rejected" | "unknown";

/** 带结果分类的支付创建错误，供上层决定补偿策略 */
export class PaymentCreationError extends Error {
  readonly outcome: Exclude<PaymentCreationOutcome, "confirmed">;
  constructor(outcome: Exclude<PaymentCreationOutcome, "confirmed">, message: string) {
    super(message);
    this.name = "PaymentCreationError";
    this.outcome = outcome;
  }
}

const KNOWN_PROVIDERS = ["mock", "bepusdt", "litepay"] as const;

/**
 * 是否为当前部署「真正启用」的渠道。
 * 安全要点：mock 是本地测试渠道，其回调令牌有默认值（非机密），
 * 因此绝不能在生产回调入口可达——否则任何人可伪造「支付成功」白嫖并发货。
 * 仅当 PAYMENT_DRIVER=mock 显式开启时才承认 mock（PLAN §10）。
 */
export function isProviderEnabled(name: string): boolean {
  const driver = process.env.PAYMENT_DRIVER ?? "auto";
  if (name === "mock") return driver === "mock";
  return (KNOWN_PROVIDERS as readonly string[]).includes(name);
}

export function isKnownProvider(name: string): boolean {
  return isProviderEnabled(name);
}

/** 按渠道名实例化（回调路由按 [provider] 分发）；未启用的渠道一律拒绝 */
export function getProvider(name: string): PaymentProvider {
  if (!isProviderEnabled(name)) {
    throw new PaymentError("UNKNOWN_PROVIDER", `未启用的支付渠道: ${name}`);
  }
  switch (name) {
    case "mock":
      return mockProvider();
    case "bepusdt":
      return bepusdtProvider(getPaymentConfig("bepusdt")?.configJson ?? {});
    case "litepay":
      return litepayProvider(getPaymentConfig("litepay")?.configJson ?? {});
    default:
      throw new PaymentError("UNKNOWN_PROVIDER", `未知支付渠道: ${name}`);
  }
}

/** 前台可选的支付方式标识（对外契约，前端按此提交） */
export type CheckoutMethod = "bepusdt" | "litepay";

/** 网关型渠道（有收银台/回调，可被 auto 选中）；exchange:* 轮询渠道不在此列 */
const GATEWAY_PROVIDERS: readonly CheckoutMethod[] = ["bepusdt", "litepay"];

/** 渠道在收银台选项中的展示元数据（存 payment_configs.config_json，后台可改） */
interface ChannelDisplayMeta {
  /** 自定义显示名称；空 = 用渠道默认文案 */
  displayName: string;
  /** 展示优先级：数字越小越靠前；未配置按 0，同序时按渠道名排序保证可复现 */
  sortOrder: number;
}

function channelDisplayMeta(provider: string, configJson: Record<string, unknown>): ChannelDisplayMeta {
  const rawName = typeof configJson["display_name"] === "string" ? configJson["display_name"].trim() : "";
  const rawOrder = Number(configJson["sort_order"]);
  return {
    displayName: rawName,
    sortOrder: Number.isFinite(rawOrder) && rawOrder >= 0 ? Math.trunc(rawOrder) : 0,
  };
}

function gatewayConfigEnabled(provider: string): boolean {
  const row = getPaymentConfig(provider);
  return row !== null && row.enabled;
}

/**
 * 前台可选的支付方式，按渠道配置的优先级排序（sort_order 升序，同序按名称）。
 *
 * 历史问题一：`auto` 直接取 payment_configs 返回顺序的第一个启用渠道，
 * 而该顺序无保证。启用交易所渠道后，可能出现「买家被分配到交易所转账，
 * 但前台没有转账指引 → 订单无法付款」的悬空订单。
 * 现在 auto 只从**网关型**渠道中选（交易所需在下单时显式指定）。
 * 交易所渠道单独走 createExchangeOrder()，其可用性以配置是否完整为准。
 *
 * 历史问题二：bepusdt 无条件出现在前台选项里（不检查后台启用状态），
 * 导致「后台停用的渠道仍对买家可见」。重构 LitePay 渠道后 bepusdt 已停用，
 * 买家却仍能选中它并被带到旧网关。两个网关渠道现在用**同一判据**：
 * payment_configs 中 enabled=true 才暴露（与 resolvePaymentProviderDefault 一致）。
 */
export function listCheckoutMethods(): CheckoutMethod[] {
  const methods = GATEWAY_PROVIDERS.filter(
    (p) => gatewayConfigEnabled(p) || (p === "bepusdt" && (process.env.PAYMENT_DRIVER ?? "auto") === "bepusdt")
  );
  return sortGatewayMethods(methods);
}

/** 渠道排序：config_json.sort_order 升序，同序按渠道名（固定可复现） */
function sortGatewayMethods(methods: CheckoutMethod[]): CheckoutMethod[] {
  return [...methods].sort((a, b) => {
    const ma = channelDisplayMeta(a, getPaymentConfig(a)?.configJson ?? {});
    const mb = channelDisplayMeta(b, getPaymentConfig(b)?.configJson ?? {});
    return ma.sortOrder - mb.sortOrder || a.localeCompare(b);
  });
}

/** 各网关渠道的默认收银台文案（后台可用 display_name 覆盖名称） */
const DEFAULT_CHECKOUT_COPY: Record<CheckoutMethod, { label: string; hint: string }> = {
  bepusdt: {
    label: "加密货币收银台",
    hint: "跳转收银台，使用 USDT 等加密货币支付，到账后自动发货",
  },
  litepay: {
    label: "LitePay 收银台（USDT / USDC）",
    hint: "跳转收银台，选 Binance / OKX 按精确金额站内转账，到账后自动发货",
  },
};

export interface CheckoutOptionInfo {
  method: CheckoutMethod;
  label: string;
  hint: string;
}

/**
 * 收银台选项（含文案），按渠道优先级排序。
 * 名称可由后台「显示名称」自定义，留空回落到渠道默认文案。
 */
export function getCheckoutOptions(): CheckoutOptionInfo[] {
  return listCheckoutMethods().map((method) => {
    const meta = channelDisplayMeta(method, getPaymentConfig(method)?.configJson ?? {});
    const fallback = DEFAULT_CHECKOUT_COPY[method];
    return { method, label: meta.displayName || fallback.label, hint: fallback.hint };
  });
}

/**
 * 解析下单使用的**网关型**渠道。
 *
 * - 指定 method 且非 exchange：校验后使用（前台显式选择）
 * - 未指定 / 指定 exchange：走 auto，仅取网关渠道
 *   （交易所收款由 createExchangeOrder 单独处理，不经过本函数）
 */
export function resolvePaymentProvider(requested?: string): PaymentProvider {
  if (requested && requested !== "bepusdt" && requested !== "litepay") {
    throw new PaymentError("UNKNOWN_PAYMENT_METHOD", `未知的支付方式: ${requested}`);
  }
  if (requested === "litepay") {
    return litepayProvider(getPaymentConfig("litepay")?.configJson ?? {});
  }
  return resolvePaymentProviderDefault();
}

/**
 * 当前下单使用的渠道：
 * - PAYMENT_DRIVER=mock|bepusdt：显式指定
 * - auto：仅取 payment_configs 中**已启用的网关型**渠道，按渠道配置的优先级
 *   （sort_order 升序，同序按名称）选择，与前台展示顺序一致
 */
export function resolvePaymentProviderDefault(): PaymentProvider {
  const driver = process.env.PAYMENT_DRIVER ?? "auto";
  if (driver === "mock") return mockProvider();
  if (driver === "bepusdt") {
    return bepusdtProvider(getPaymentConfig("bepusdt")?.configJson ?? {});
  }
  // auto：**只**从网关型渠道中选，且按后台配置的优先级，保证结果确定。
  //
  // 历史缺陷：直接取 payment_configs 返回顺序的第一个启用渠道。启用交易所
  // 渠道后顺序无保证，可能选中交易所 → 买家被分配到一条前台没有指引、
  // 无从付款的通道（下单成功却付不了，属可用性事故）。
  const candidates = sortGatewayMethods(
    GATEWAY_PROVIDERS.filter((p) => gatewayConfigEnabled(p))
  );
  const chosen = candidates.find((p) => isProviderEnabled(p));
  if (!chosen) {
    if (process.env.NODE_ENV !== "production") return mockProvider();
    throw new PaymentError("NO_PAYMENT_CHANNEL", "未启用任何支付渠道，请到后台设置");
  }
  return getProvider(chosen);
}
