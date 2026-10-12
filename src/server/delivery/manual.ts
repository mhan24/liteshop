import { eq, sql } from "drizzle-orm";
import { products } from "@/db/schema";
import type { DbTransaction } from "@/db";
import type {
  DeliveryOutcome,
  DeliveryStrategy,
  OrderLike,
  ProductLike,
  ReleaseOutcome,
} from "./strategy";
import { isUnlimitedStock } from "@/lib/stock";

/**
 * 人工发货：支付后订单停留 paid，管理员在后台录入交付内容后置 completed。
 * 库存模型：stock_limit = -1 表示不限；>= 0 时下单即条件扣减
 * （WHERE stock_limit >= quantity），关单且从未交付时回补。
 */
export const manualDelivery: DeliveryStrategy = {
  type: "manual",

  fulfill(): DeliveryOutcome {
    // 自动流程不适用于人工发货（订单应停留 paid，等待后台录入）
    return { ok: false, content: null, reason: "人工发货需在后台手动录入" };
  },

  release(tx: DbTransaction, order: OrderLike, product: ProductLike): ReleaseOutcome {
    // 幂等守卫：
    // 1) 已交付的订单不回补（禁止硬删除已产生交易关联的数据）
    // 2) stockCharged=false 表示本单未占用库存，或**已经回补过**
    if (order.deliveryContent != null) return { released: false };
    if (!order.stockCharged) return { released: false };

    // 3) 库存模式已被管理员改为「不限」→ **绝不能做数量回补**。
    //    -1 是"不限"的哨兵值，对它加 quantity 会得到 0 及以上的具体数字，
    //    把商品意外变成"售罄"（实测 -1 + 1 = 0）。
    //    本单原先占用的那一份已随模式切换失去意义，直接视为无需回补。
    if (isUnlimitedStock(product.stockLimit)) {
      return { released: false };
    }

    tx
      .update(products)
      .set({ stockLimit: sql`${products.stockLimit} + ${order.quantity}`, updatedAt: new Date() })
      .where(eq(products.id, product.id))
      .run();
    return { released: true, restoredQuantity: order.quantity };
  },
};
