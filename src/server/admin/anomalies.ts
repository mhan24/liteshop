import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentAnomalies, products } from "@/db/schema";
import type { AnomalyStatusType } from "@/db/schema";
import { getDeliveryStrategy } from "@/server/delivery";

/**
 * 异常到账（超时后到账）的查询与人工处置。
 *
 * 业务规则：异常到账**不能自动发货**。清扫已把卡密释放回 available，
 * 可能已被其他订单买走；直接给原订单发卡会造成一卡多卖。
 * 正确流程是管理员核对链上到账后，选择「补发」（从卡池重新取卡并交付）
 * 或「退款」，并留下处理备注。
 */

export interface AnomalyRow {
  id: number;
  orderNo: string;
  provider: string;
  tradeId: string | null;
  amount: string;
  currency: string;
  orderStatusAtArrival: string;
  kind: string;
  status: string;
  resolution: string;
  createdAt: Date;
  /** 订单当前状态（便于判断是否已被其他途径处理） */
  orderStatus: string | null;
  productName: string | null;
  email: string | null;
}

export function listAnomalies(opts?: { status?: string; limit?: number }): AnomalyRow[] {
  const limit = Math.min(opts?.limit ?? 100, 500);
  const conds = [];
  if (opts?.status && ["open", "reissued", "refunded", "dismissed"].includes(opts.status)) {
    conds.push(eq(paymentAnomalies.status, opts.status));
  }
  const rows = db
    .select({
      id: paymentAnomalies.id,
      orderNo: paymentAnomalies.orderNo,
      provider: paymentAnomalies.provider,
      tradeId: paymentAnomalies.tradeId,
      amount: paymentAnomalies.amount,
      currency: paymentAnomalies.currency,
      orderStatusAtArrival: paymentAnomalies.orderStatusAtArrival,
      kind: paymentAnomalies.kind,
      status: paymentAnomalies.status,
      resolution: paymentAnomalies.resolution,
      createdAt: paymentAnomalies.createdAt,
      orderStatus: orders.status,
      productName: orders.productName,
      email: orders.email,
    })
    .from(paymentAnomalies)
    .leftJoin(orders, eq(paymentAnomalies.orderNo, orders.orderNo))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(paymentAnomalies.id))
    .limit(limit)
    .all();
  return rows as AnomalyRow[];
}

export function countOpenAnomalies(): number {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(paymentAnomalies)
      .where(eq(paymentAnomalies.status, "open"))
      .get()?.c ?? 0
  );
}

export interface AnomalyOpResult {
  ok: boolean;
  message: string;
  /** 补发成功时返回交付内容，供管理员核对 */
  deliveryContent?: string;
}

/**
 * 补发商品：从卡池**重新取卡**并交付，订单置为 completed。
 *
 * 注意这里走的是完整的占卡/交付流程（与正常发货一致），
 * 而不是去恢复当初被释放的那张卡 —— 那张卡可能已被他人买走。
 * 若卡池已空则失败，管理员可选择退款或补货后重试。
 */
export function reissueAnomaly(anomalyId: number, note: string): AnomalyOpResult {
  return db.transaction(
    (tx) => {
      const anomaly = tx
        .select()
        .from(paymentAnomalies)
        .where(eq(paymentAnomalies.id, anomalyId))
        .get();
      if (!anomaly) return { ok: false, message: "异常记录不存在" };
      if (anomaly.status !== "open") {
        return { ok: false, message: `该异常已处理（${anomaly.status}）` };
      }

      const order = tx.select().from(orders).where(eq(orders.orderNo, anomaly.orderNo)).get();
      if (!order) return { ok: false, message: "关联订单不存在" };
      if (order.status === "completed") {
        return { ok: false, message: "订单已交付，无需补发" };
      }

      const product = order.productId
        ? tx.select().from(products).where(eq(products.id, order.productId)).get()
        : null;
      if (!product) return { ok: false, message: "订单关联商品不存在，无法补发" };

      const outcome = getDeliveryStrategy(product.deliveryType).fulfill(tx, order, product);
      if (!outcome.ok || outcome.content == null) {
        return {
          ok: false,
          message: `补发失败：${outcome.reason ?? "卡池不足，请补货后重试或改为退款"}`,
        };
      }

      tx.update(orders)
        .set({
          status: "completed",
          deliveryContent: outcome.content,
          paidAt: order.paidAt ?? new Date(),
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .run();

      tx.update(paymentAnomalies)
        .set({ status: "reissued", resolution: note.slice(0, 500), updatedAt: new Date() })
        .where(eq(paymentAnomalies.id, anomalyId))
        .run();

      return { ok: true, message: "已补发商品", deliveryContent: outcome.content };
    },
    { behavior: "immediate" }
  );
}

/** 标记为已退款 / 误报（仅记录处置结果，不动订单与库存） */
export function resolveAnomalyAs(
  anomalyId: number,
  status: Extract<AnomalyStatusType, "refunded" | "dismissed">,
  note: string
): AnomalyOpResult {
  return db.transaction(
    (tx) => {
      const anomaly = tx
        .select()
        .from(paymentAnomalies)
        .where(eq(paymentAnomalies.id, anomalyId))
        .get();
      if (!anomaly) return { ok: false, message: "异常记录不存在" };
      if (anomaly.status !== "open") {
        return { ok: false, message: `该异常已处理（${anomaly.status}）` };
      }
      tx.update(paymentAnomalies)
        .set({ status, resolution: note.slice(0, 500), updatedAt: new Date() })
        .where(eq(paymentAnomalies.id, anomalyId))
        .run();
      return {
        ok: true,
        message: status === "refunded" ? "已标记为退款" : "已标记为误报",
      };
    },
    { behavior: "immediate" }
  );
}
