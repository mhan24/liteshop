import { sql } from "drizzle-orm";
import type { DbTransaction } from "@/db";
import type {
  DeliveryOutcome,
  DeliveryStrategy,
  OrderLike,
  ProductLike,
} from "./strategy";

/**
 * 自动卡密发货。
 * 并发安全（PLAN §6-①）：调用方持有 IMMEDIATE 写事务；占卡使用条件 UPDATE
 * （WHERE status='available'），以受影响行数为准，绝不超卖。
 * 状态流转：available --占卡--> reserved --确认--> sold；失败/关单 reserved 释放回 available。
 */
export const autoDelivery: DeliveryStrategy = {
  type: "auto",

  fulfill(tx: DbTransaction, order: OrderLike, product: ProductLike): DeliveryOutcome {
    // 1) 重试场景：先复用本订单已占用的 reserved 卡密
    const reserved = tx.all<{ id: number; content: string }>(
      sql`SELECT id, content FROM cards WHERE order_id = ${order.orderNo} AND status = 'reserved' ORDER BY id`
    );
    const contents: string[] = reserved.map((r) => r.content);
    let missing = order.quantity - reserved.length;

    // 2) 原子占卡补足差额
    while (missing > 0) {
      const claimed = tx.all<{ id: number; content: string }>(
        sql`UPDATE cards
            SET status = 'reserved', order_id = ${order.orderNo}
            WHERE id IN (
              SELECT id FROM cards
              WHERE product_id = ${product.id} AND status = 'available'
              ORDER BY id
              LIMIT ${missing}
            )
            RETURNING id, content`
      );
      if (claimed.length === 0) {
        return {
          ok: false,
          content: null,
          reason: `卡池不足：已占用 ${contents.length}/${order.quantity}`,
        };
      }
      for (const c of claimed) contents.push(c.content);
      missing -= claimed.length;
    }

    // 3) 确认交付：reserved → sold
    tx.run(
      sql`UPDATE cards SET status = 'sold', sold_at = ${Date.now()} WHERE order_id = ${order.orderNo} AND status = 'reserved'`
    );

    return { ok: true, content: contents.join("\n") };
  },

  release(tx: DbTransaction, order: OrderLike): void {
    tx.run(
      sql`UPDATE cards SET status = 'available', order_id = NULL, sold_at = NULL
          WHERE order_id = ${order.orderNo} AND status = 'reserved'`
    );
  },
};
