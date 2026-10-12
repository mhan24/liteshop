import { desc, eq, and, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, paymentAnomalies, paymentAttempts, products } from "@/db/schema";
import type { AnomalyStatusType } from "@/db/schema";
import { getDeliveryStrategy } from "@/server/delivery";
import type { DbTransaction } from "@/db";
import { shouldChargeStock } from "@/lib/stock";

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
 * 补发商品 —— 自动卡密商品。
 *
 * 走完整 fulfill 流程**从卡池重新取卡**（而非恢复当初被释放的那张卡，
 * 那张可能已被他人买走）。卡池不足则失败，管理员可改为退款。
 *
 * 人工发货商品请用 acceptAnomalyForManualDelivery()。
 */
export function reissueAnomaly(anomalyId: number, note: string): AnomalyOpResult {
  return db.transaction(
    (tx) => {
      const loaded = loadAnomalyForAction(tx, anomalyId);
      if (!loaded.ok) return loaded;
      const { anomaly, order, product } = loaded;

      if (product.deliveryType !== "auto") {
        return {
          ok: false,
          message:
            "人工发货商品不能自动补发，请改用「转入人工发货」并在订单页录入交付内容",
        };
      }

      const outcome = getDeliveryStrategy("auto").fulfill(tx, order, product);
      if (!outcome.ok || outcome.content == null) {
        return {
          ok: false,
          message: `补发失败：${outcome.reason ?? "卡池不足，请补货后重试或改为退款"}`,
        };
      }

      finalizeDelivery(tx, anomaly, order, outcome.content, note, "reissued");
      return { ok: true, message: "已补发商品", deliveryContent: outcome.content };
    },
    { behavior: "immediate" }
  );
}

/**
 * 补发商品 —— 人工发货商品。
 *
 * 人工商品没有卡池，交付由管理员录入。这里只把订单**放回待人工发货队列**
 * （status=paid），并核对库存计数：
 *
 * 库存关键点：订单过期时 release() 已把下单时扣减的库存**回补**过
 * （依据 stockCharged），因此这里必须把该标记**复位为 false**，
 * 表示"当前没有为这笔订单占用库存"。否则管理员后续关闭该订单时
 * release() 会再回补一次，造成库存虚增（重复计数）。
 */
export function acceptAnomalyForManualDelivery(anomalyId: number, note: string): AnomalyOpResult {
  return db.transaction(
    (tx) => {
      const loaded = loadAnomalyForAction(tx, anomalyId);
      if (!loaded.ok) return loaded;
      const { order, product } = loaded;

      if (product.deliveryType !== "manual") {
        return { ok: false, message: "该商品为自动发卡，请使用「补发商品」" };
      }

      // 防止重复占用：若此前已回补过库存，这里不再二次扣减，
      // 仅复位标记，使后续 release() 不会重复回补。
      const alreadyReleased = order.stockCharged === false;
      const trackStock = shouldChargeStock(product.stockLimit);

      if (!alreadyReleased && trackStock) {
        // 重新占用一份库存（与下单时的条件扣减一致，不足则拒绝）
        const res = tx
          .update(products)
          .set({ stockLimit: sql`${products.stockLimit} - ${order.quantity}` })
          .where(
            and(
              eq(products.id, product.id),
              sql`${products.stockLimit} >= ${order.quantity}`
            )
          )
          .run();
        if (Number(res.changes ?? 0) === 0) {
          return { ok: false, message: "库存不足，无法重新占用；请补货或改为退款" };
        }
      }

      tx.update(orders)
        .set({
          status: "paid",
          paidAt: order.paidAt ?? new Date(),
          // 复位占用标记：库存要么已重新扣减（下面置 true），要么本就未占用
          stockCharged: !alreadyReleased && trackStock,
          expirationTime: null,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .run();

      tx.update(paymentAnomalies)
        .set({
          status: "reissued",
          resolution: `${note || "核实到账"}（转入人工发货）`.slice(0, 500),
          updatedAt: new Date(),
        })
        .where(eq(paymentAnomalies.id, anomalyId))
        .run();

      return { ok: true, message: "已转入人工发货，请在订单页录入交付内容" };
    },
    { behavior: "immediate" }
  );
}

/** 载入并校验异常记录与订单（补发类操作共用） */
function loadAnomalyForAction(
  tx: DbTransaction,
  anomalyId: number
):
  | { ok: true; anomaly: typeof paymentAnomalies.$inferSelect; order: typeof orders.$inferSelect; product: typeof products.$inferSelect }
  | { ok: false; message: string } {
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
  return { ok: true, anomaly, order, product };
}

/** 交付完成后统一落库：订单置 completed + 同步支付尝试 + 关闭异常 */
function finalizeDelivery(
  tx: DbTransaction,
  anomaly: typeof paymentAnomalies.$inferSelect,
  order: typeof orders.$inferSelect,
  content: string,
  note: string,
  status: "reissued"
): void {
  tx.update(orders)
    .set({
      status: "completed",
      deliveryContent: content,
      paidAt: order.paidAt ?? new Date(),
      updatedAt: new Date(),
    })
    .where(eq(orders.id, order.id))
    .run();

  // 同步支付尝试：此前该交易可能被标记为 expired（订单曾超时），
  // 现确认已到账，必须改正，否则后续对账会误判为未收款。
  if (anomaly.tradeId) {
    tx.update(paymentAttempts)
      .set({ status: "paid", paidAt: new Date(), updatedAt: new Date() })
      .where(eq(paymentAttempts.tradeId, anomaly.tradeId))
      .run();
  }

  tx.update(paymentAnomalies)
    .set({ status, resolution: note.slice(0, 500), updatedAt: new Date() })
    .where(eq(paymentAnomalies.id, anomaly.id))
    .run();
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
