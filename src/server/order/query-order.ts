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
  return toPublicView(order, { includeDelivery: false });
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
