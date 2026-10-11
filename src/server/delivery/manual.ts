import { eq, sql } from "drizzle-orm";
import { products } from "@/db/schema";
import type { DbTransaction } from "@/db";
import type {
  DeliveryOutcome,
  DeliveryStrategy,
  OrderLike,
  ProductLike,
} from "./strategy";

/**
 * 人工发货：支付后订单停留 paid，管理员在后台录入交付内容后置 completed。
 * 库存模型：stock_limit > 0 时下单即条件扣减（WHERE stock_limit >= quantity），
 * 关单且从未交付时回补。
 */
export const manualDelivery: DeliveryStrategy = {
  type: "manual",

  fulfill(): DeliveryOutcome {
    // 自动流程不适用于人工发货（订单应停留 paid，等待后台录入）
    return { ok: false, content: null, reason: "人工发货需在后台手动录入" };
  },

  release(tx: DbTransaction, order: OrderLike, product: ProductLike): void {
    // 从未交付且下单时真扣过库存才回补（硬约束：禁止硬删除已产生交易关联的数据）
    if (order.deliveryContent != null) return;
    if (!order.stockCharged) return;
    tx
      .update(products)
      .set({ stockLimit: sql`${products.stockLimit} + ${order.quantity}`, updatedAt: new Date() })
      .where(eq(products.id, product.id))
      .run();
  },
};
