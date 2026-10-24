import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { deliveries, orderItems, orders, payments } from "@/db/schema";
import { verifyQueryPassword } from "@/lib/query-password";
import { desc } from "drizzle-orm";

/**
 * 订单查询：邮箱 + 订单号 + 查单密码 三因子。
 *
 * - 查单密码为 Argon2id 哈希存储；验证失败统一返回 null（不区分错在哪一项）
 * - 限流在 action 层按 IP + 邮箱执行；仅凭邮箱永远无法获取订单内容
 */

export interface OrderQueryView {
  orderNo: string;
  status: string;
  currency: string;
  totalCents: number;
  createdAt: Date;
  paidAt: Date | null;
  completedAt: Date | null;
  expiresAt: Date | null;
  note: string | null;
  items: Array<{ productName: string; quantity: number; unitPriceCents: number; lineTotalCents: number }>;
  /** 已交付内容（仅 completed） */
  deliveryContent: string | null;
  /** 待支付订单的收银台地址 */
  paymentUrl: string | null;
}

export async function queryOrder(
  email: string,
  orderNo: string,
  password: string
): Promise<OrderQueryView | null> {
  const mail = email.trim().toLowerCase();
  const no = orderNo.trim();
  if (!mail || !no) return null;

  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNo, no), eq(orders.email, mail)))
    .limit(1);
  const order = rows[0];
  if (!order) return null;
  const ok = await verifyQueryPassword(order.queryPasswordHash, password.trim().toUpperCase());
  if (!ok) return null;

  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const deliveryRows = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.orderId, order.id))
    .limit(1);
  const paymentRows = await db
    .select()
    .from(payments)
    .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)))
    .orderBy(desc(payments.id))
    .limit(1);

  return {
    orderNo: order.orderNo,
    status: order.status,
    currency: order.currency,
    totalCents: order.totalCents,
    createdAt: order.createdAt,
    paidAt: order.paidAt,
    completedAt: order.completedAt,
    expiresAt: order.expiresAt,
    note: order.note,
    items: items.map((i) => ({
      productName: i.productName,
      quantity: i.quantity,
      unitPriceCents: i.unitPriceCents,
      lineTotalCents: i.lineTotalCents,
    })),
    deliveryContent: order.status === "completed" ? (deliveryRows[0]?.content ?? null) : null,
    paymentUrl: order.status === "pending" ? (paymentRows[0]?.paymentUrl ?? null) : null,
  };
}
