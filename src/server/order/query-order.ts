import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentAnomalies, products } from "@/db/schema";
import type { Order, OrderStatus } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { formatDateTime } from "@/lib/datetime";
import { isValidOrderNo } from "@/lib/order-no";
import { expireOrderIfOverdue } from "./expire-orders";
import { canRepurchase as canRepurchaseStatus, repurchaseBlockedReason } from "./create-order";

/** 查单服务：前台查单页（订单号+邮箱双因子）与支付回跳页轮询 */

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待支付",
  reconciling: "待对账",
  paid: "已支付 · 处理中",
  delivering: "发货中",
  completed: "已完成",
  expired: "已超时",
  closed: "已关闭",
};

export interface PublicOrderView {
  orderNo: string;
  productName: string;
  /** 商品标识：过期/关闭后用于「重新购买」跳回商品页 */
  productSlug: string | null;
  quantity: number;
  totalFormatted: string;
  currency: string;
  status: OrderStatus;
  statusLabel: string;
  emailMasked: string;
  createdAt: Date;
  createdAtText: string;
  paidAt: Date | null;
  /** 仅 completed 状态对买家可见（PLAN §6-②） */
  deliveryContent: string | null;
  /** 仅 pending 暴露：继续支付入口 */
  paymentUrl: string | null;
  expiresAtText: string | null;
  /** 是否允许重新购买（状态 + 未收款 + 无待处理异常到账）——前台按钮以此为准 */
  canRepurchase: boolean;
  /** 不能重购的原因（canRepurchase=false 时有值），用于前台提示 */
  repurchaseBlockedReason: string | null;
  /**
   * 交易所转账指引；非交易所渠道为 null。
   *
   * 买家必须看到「转多少钱到哪个账户」才能付款 —— 交易所没有收银台地址，
   * 缺了这块信息就会下单成功却无从支付。
   */
  transferInstructions: {
    /** 交易所名称（币安 / 欧易） */
    exchange: string;
    /** 收款账户标识（Binance ID / OKX UID） */
    accountId: string;
    /** 必须精确转账的金额（唯一金额，保证到账可被识别） */
    amount: string;
    /** 收款币种 */
    asset: string;
    /** 支付截止时间 */
    expiresAtText: string | null;
  } | null;
}

export function lookupOrder(orderNo: string, email: string): PublicOrderView | null {
  const no = orderNo.trim();
  const mail = email.trim().toLowerCase();
  if (!no || !mail || !isValidOrderNo(no)) return null;
  // 惰性超时清扫：避免过期订单仍显示"待支付/继续支付"占着库存
  expireOrderIfOverdue(no);
  const order = db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNo, no), sql`lower(${orders.email}) = ${mail}`))
    .get();
  if (!order) return null;
  return toPublicView(order);
}

/** 支付回跳页轮询：仅凭订单号给出受限视图（不含交付内容） */
export function getOrderStatusView(orderNo: string): PublicOrderView | null {
  const no = orderNo.trim();
  if (!no || !isValidOrderNo(no)) return null;
  // 惰性超时清扫：轮询是高频读路径，超时订单在此被及时关闭并释放库存
  expireOrderIfOverdue(no);
  const order = db.select().from(orders).where(eq(orders.orderNo, no)).get();
  if (!order) return null;
  // 不返回邮箱：本接口**仅凭订单号**即可访问，而脱敏邮箱会暴露
  // 「查单 + 取货」双因子的第二项线索（如 ab***@example.com 很容易猜全）。
  // 邮箱只在双因子校验通过后的 lookupOrder() 结果里展示。
  const view = toPublicView(order, { includeDelivery: false });
  return { ...view, emailMasked: "***" };
}

function toPublicView(order: Order, opts?: { includeDelivery?: boolean }): PublicOrderView {
  const includeDelivery = opts?.includeDelivery ?? true;
  // 商品可能已被删除（productId 为空），此时无法提供重新购买入口
  const productSlug = order.productId
    ? (db.select({ slug: products.slug }).from(products).where(eq(products.id, order.productId)).get()
        ?.slug ?? null)
    : null;
  return {
    orderNo: order.orderNo,
    productName: order.productName,
    productSlug,
    quantity: order.quantity,
    totalFormatted: formatMoney(BigInt(order.totalCents), order.currency),
    currency: order.currency,
    status: order.status as OrderStatus,
    statusLabel: STATUS_LABELS[order.status as OrderStatus] ?? order.status,
    emailMasked: maskEmail(order.email),
    createdAt: order.createdAt,
    createdAtText: formatDateTime(order.createdAt) ?? "",
    paidAt: order.paidAt,
    deliveryContent:
      includeDelivery && order.status === "completed" ? (order.deliveryContent ?? "") : null,
    paymentUrl: order.status === "pending" ? (order.paymentUrl ?? null) : null,
    // 无有效期（渠道未返回/建单失败）时不展示该行，避免渲染成 1970 纪元时间
    expiresAtText: order.status === "pending" ? formatDateTime(order.expirationTime) : null,
    // 重购资格由服务端统一计算，前台按钮直接以此为准，
    // 避免「按钮显示了但提交才被拒」的不一致体验
    ...computeRepurchaseEligibility(order),
    ...computeTransferInstructions(order),
  };
}

function maskEmail(email: string): string {
  const at = email.indexOf("@");
  if (at <= 0) return "***";
  const local = email.slice(0, at);
  const domain = email.slice(at);
  const head = local.slice(0, Math.min(2, local.length));
  return `${head}***${domain}`;
}

/** mock 收银台内部数据（页面仅 PAYMENT_DRIVER=mock 时可达） */
export interface MockCheckoutData {
  orderNo: string;
  productName: string;
  quantity: number;
  totalFormatted: string;
  currency: string;
  status: OrderStatus;
  statusLabel: string;
  tradeId: string | null;
  amountCents: bigint;
}

export function getMockCheckoutData(orderNo: string): MockCheckoutData | null {
  const no = orderNo.trim();
  if (!no || !isValidOrderNo(no)) return null;
  const order = db.select().from(orders).where(eq(orders.orderNo, no)).get();
  if (!order) return null;
  const status = order.status as OrderStatus;
  return {
    orderNo: order.orderNo,
    productName: order.productName,
    quantity: order.quantity,
    totalFormatted: formatMoney(BigInt(order.totalCents), order.currency),
    currency: order.currency,
    status,
    statusLabel: STATUS_LABELS[status] ?? order.status,
    tradeId: order.tradeId,
    amountCents: BigInt(order.totalCents),
  };
}

/**
 * 计算订单的重购资格（前台按钮与服务端校验的唯一真相）。
 *
 * 必须同时满足：
 * 1. 状态属于白名单（expired / closed）
 * 2. 无实际收款记录（paidAt 为空）—— 状态机允许 paid → closed，
 *    仅凭 status 判断不出是否收过钱
 * 3. 无待处理的异常到账（payment_anomalies.status = 'open'）——
 *    此时买家是否付款尚未核实，允许重购会造成重复付款
 */
function computeRepurchaseEligibility(order: Order): {
  canRepurchase: boolean;
  repurchaseBlockedReason: string | null;
} {
  if (!canRepurchaseStatus(order.status)) {
    return { canRepurchase: false, repurchaseBlockedReason: null };
  }
  const hasOpenAnomaly = db
    .select({ id: paymentAnomalies.id })
    .from(paymentAnomalies)
    .where(and(eq(paymentAnomalies.orderNo, order.orderNo), eq(paymentAnomalies.status, "open")))
    .get();
  const reason = repurchaseBlockedReason(order, !!hasOpenAnomaly);
  return { canRepurchase: reason === null, repurchaseBlockedReason: reason };
}

/**
 * 计算交易所转账指引。
 *
 * 仅在「交易所渠道 + 仍待支付 + 配置完整」时返回；其余一律 null，
 * 让前台回退到普通收银台入口。
 * 金额取自订单的应付金额快照（"<金额> <币种>"），与扫描器匹配用的是同一份数据，
 * 因此买家看到的数字与系统等待的到账**必然一致**。
 */
function computeTransferInstructions(order: Order): {
  transferInstructions: PublicOrderView["transferInstructions"];
} {
  if (order.status !== "pending") return { transferInstructions: null };
  const stored = order.expectedActualAmount?.trim();
  if (!stored) return { transferInstructions: null };
  const m = /^([0-9.]+)\s+([A-Za-z]+)$/.exec(stored);
  if (!m) return { transferInstructions: null };
  let channel;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    channel = require("@/server/exchange/channel") as typeof import("@/server/exchange/channel");
  } catch {
    return { transferInstructions: null };
  }
  const asset = m[2].toUpperCase();
  const view = ["binance", "okx"]
    .map((id) => channel.getExchangeChannelView(id as "binance" | "okx"))
    .find((v) => v.enabled && v.asset.toUpperCase() === asset && v.accountId);
  if (!view) return { transferInstructions: null };
  return {
    transferInstructions: {
      exchange: view.provider === "binance" ? "币安 Binance" : "欧易 OKX",
      accountId: view.accountId,
      amount: m[1],
      asset,
      expiresAtText:
        order.status === "pending" ? formatDateTime(order.expirationTime) : null,
    },
  };
}
