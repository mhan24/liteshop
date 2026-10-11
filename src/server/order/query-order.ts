import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import type { Order, OrderStatus } from "@/db/schema";
import { formatCents } from "@/lib/money";
import { isValidOrderNo } from "@/lib/order-no";

/** 查单服务：前台查单页（订单号+邮箱双因子）与支付回跳页轮询 */

export const STATUS_LABELS: Record<OrderStatus, string> = {
  pending: "待支付",
  paid: "已支付 · 处理中",
  delivering: "发货中",
  completed: "已完成",
  expired: "已超时",
  closed: "已关闭",
};

export interface PublicOrderView {
  orderNo: string;
  productName: string;
  quantity: number;
  totalFormatted: string;
  currency: string;
  status: OrderStatus;
  statusLabel: string;
  emailMasked: string;
  createdAt: Date;
  paidAt: Date | null;
  /** 仅 completed 状态对买家可见（PLAN §6-②） */
  deliveryContent: string | null;
}

export function lookupOrder(orderNo: string, email: string): PublicOrderView | null {
  const no = orderNo.trim();
  const mail = email.trim().toLowerCase();
  if (!no || !mail || !isValidOrderNo(no)) return null;
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
  const order = db.select().from(orders).where(eq(orders.orderNo, no)).get();
  if (!order) return null;
  return toPublicView(order, { includeDelivery: false });
}

function toPublicView(order: Order, opts?: { includeDelivery?: boolean }): PublicOrderView {
  const includeDelivery = opts?.includeDelivery ?? true;
  return {
    orderNo: order.orderNo,
    productName: order.productName,
    quantity: order.quantity,
    totalFormatted: formatCents(BigInt(order.totalCents)),
    currency: order.currency,
    status: order.status as OrderStatus,
    statusLabel: STATUS_LABELS[order.status as OrderStatus] ?? order.status,
    emailMasked: maskEmail(order.email),
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    deliveryContent:
      includeDelivery && order.status === "completed" ? (order.deliveryContent ?? "") : null,
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
    totalFormatted: formatCents(BigInt(order.totalCents)),
    currency: order.currency,
    status,
    statusLabel: STATUS_LABELS[status] ?? order.status,
    tradeId: order.tradeId,
    amountCents: BigInt(order.totalCents),
  };
}
