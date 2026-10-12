import { eq, sql } from "drizzle-orm";
import { orders, products } from "@/db/schema";
import type { DbTransaction } from "@/db";
import { getDeliveryStrategy } from "./index";

/**
 * 释放订单占用的库存/卡密 —— **唯一入口**（必须在调用方事务内执行）。
 *
 * 为什么必须集中：库存释放分散在多处（超时清扫、买家取消、管理员关闭、
 * 补偿关单、异常对账），每处各自调用策略的 release()。历史上
 * `manualDelivery.release()` 只读 `stockCharged` 却从不清除它，
 * 于是「超时清扫释放一次 + 管理员关闭再释放一次」会让库存凭空 +1
 * （实测 3 → 2 → 3 → 4），进而导致超卖。
 *
 * 本函数保证两个不变量：
 * 1. **幂等**：以订单的 `stockCharged` 作为权威占用标志，
 *    释放成功后在同一事务内清除它；后续再调用直接跳过。
 * 2. **一致性**：所有释放路径共用同一实现，不再各写一份条件判断。
 *
 * @returns 本次是否真的发生了释放
 */
export function releaseOrderStock(
  tx: DbTransaction,
  orderNo: string
): { released: boolean; restoredQuantity: number } {
  const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
  if (!order) return { released: false, restoredQuantity: 0 };

  // 已交付的订单不得回补（交付内容一旦产生即为既成事实）
  if (order.deliveryContent != null) return { released: false, restoredQuantity: 0 };

  const product = order.productId
    ? tx.select().from(products).where(eq(products.id, order.productId)).get()
    : null;

  // 两类占用需要分别判定幂等性，不能共用一个标志：
  // - auto  ：下单即把卡密置为 reserved 并绑定 order_id。占用状态体现在**卡密行**上，
  //          因此「是否还需释放」应以是否仍有本单的 reserved 卡密为准
  //          （`stockCharged` 对 auto 型恒为 false，不能拿它当守卫）。
  // - manual：占用体现在商品库存上，`stockCharged` 是权威标志，
  //          释放后置 false 即可保证幂等。
  const effectiveType = getOrderDeliveryType(tx, order);
  if (effectiveType === "manual") {
    // 商品已被删除时无法回补库存，但仍需清除占用标志（见下方说明）
    if (!product) {
      if (!order.stockCharged) return { released: false, restoredQuantity: 0 };
      tx.update(orders)
        .set({ stockCharged: false, updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .run();
      return { released: true, restoredQuantity: 0 };
    }
    if (!order.stockCharged) return { released: false, restoredQuantity: 0 };
    getDeliveryStrategy("manual").release(tx, order, product);
    tx.update(orders)
      .set({ stockCharged: false, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .run();
    return { released: true, restoredQuantity: order.quantity };
  }

  // auto（或商品已删除）：按 order_id 精确释放仍处于 reserved 的卡密。
  // 条件更新天然幂等——已释放过则受影响行数为 0。
  const res = tx.run(
    sql`UPDATE cards SET status = 'available', order_id = NULL, sold_at = NULL
        WHERE order_id = ${order.orderNo} AND status = 'reserved'`
  );
  const changed = Number((res as { changes?: number }).changes ?? 0);
  if (changed > 0) {
    // 同步清除 manual 标志（若历史数据中 auto 单被误置为 true）
    if (order.stockCharged) {
      tx.update(orders)
        .set({ stockCharged: false, updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .run();
    }
    return { released: true, restoredQuantity: 0 };
  }
  return { released: false, restoredQuantity: 0 };
}

/**
 * 订单的**有效发货方式**：优先用下单快照，历史订单（快照为 NULL）回落商品当前值。
 *
 * 履约与释放都必须经过本函数，而不是直接读 product.deliveryType ——
 * 商品类型可被后台修改，历史订单不能被"追溯改性质"。
 */
export function getOrderDeliveryType(
  tx: DbTransaction,
  order: { deliveryType?: string | null; productId?: number | null }
): string {
  if (order.deliveryType === "auto" || order.deliveryType === "manual") {
    return order.deliveryType;
  }
  if (!order.productId) return "manual";
  const product = tx.select().from(products).where(eq(products.id, order.productId)).get();
  return product?.deliveryType ?? "manual";
}
