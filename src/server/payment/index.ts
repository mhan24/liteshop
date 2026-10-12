import { getPaymentConfig, listPaymentConfigs } from "@/server/settings";
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
  verifyNotify(rawBody: string): NotifyVerification;
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

const KNOWN_PROVIDERS = ["mock", "bepusdt"] as const;

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
    default:
      throw new PaymentError("UNKNOWN_PROVIDER", `未知支付渠道: ${name}`);
  }
}

/**
 * 当前下单使用的渠道：
 * - PAYMENT_DRIVER=mock|bepusdt：显式指定
 * - auto：取 payment_configs 中已启用的渠道
 */
export function resolvePaymentProvider(): PaymentProvider {
  const driver = process.env.PAYMENT_DRIVER ?? "auto";
  if (driver === "mock") return mockProvider();
  if (driver === "bepusdt") {
    return bepusdtProvider(getPaymentConfig("bepusdt")?.configJson ?? {});
  }
  const enabled = listPaymentConfigs().filter((c) => c.enabled).map((c) => c.provider);
  if (enabled.length === 0) {
    if (process.env.NODE_ENV !== "production") return mockProvider();
    throw new PaymentError("NO_PAYMENT_CHANNEL", "未启用任何支付渠道，请到后台设置");
  }
  return getProvider(enabled[0]);
}
