import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { cards, orders, products } from "@/db/schema";
import type { OrderStatus, Product } from "@/db/schema";
import { generateOrderNo } from "@/lib/order-no";
import { getSiteUrl } from "@/server/settings";
import { resolvePaymentProvider } from "@/server/payment";
import { getDeliveryStrategy } from "@/server/delivery";

/** 下单服务：库存校验 → 建单（商品快照）→ 渠道创建支付 → 回写交易快照 */

export class OrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface CreateOrderInput {
  slug: string;
  email: string;
  quantity: number;
  note?: string;
}

export interface CreateOrderResult {
  orderNo: string;
  paymentUrl: string;
  totalCents: bigint;
  currency: string;
  expiresAt: Date | null;
  provider: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const email = input.email.trim();
  const note = input.note?.trim() ?? "";
  const quantity = Math.trunc(input.quantity);

  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new OrderError("INVALID_INPUT", "请输入有效的联系邮箱");
  }
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
    throw new OrderError("INVALID_INPUT", "购买数量需在 1-99 之间");
  }
  if (note.length > 500) {
    throw new OrderError("INVALID_INPUT", "备注过长（最多 500 字）");
  }

  const product = db
    .select()
    .from(products)
    .where(and(eq(products.slug, input.slug), eq(products.status, "on")))
    .get();
  if (!product) throw new OrderError("PRODUCT_NOT_FOUND", "商品不存在或已下架");

  const totalCents = BigInt(product.priceCents) * BigInt(quantity);

  // auto 型预检（真实占卡发生在支付后的发货事务内，此处仅拦截明显缺货）
  if (product.deliveryType === "auto") {
    const available = db
      .select({ n: sql<number>`count(*)` })
      .from(cards)
      .where(and(eq(cards.productId, product.id), eq(cards.status, "available")))
      .get();
    if ((available?.n ?? 0) < quantity) {
      throw new OrderError("OUT_OF_STOCK", "库存不足");
    }
  }

  const provider = resolvePaymentProvider();
  const siteUrl = getSiteUrl();

  // 建单：IMMEDIATE 事务（manual 型条件扣减库存；订单号撞唯一索引重试）
  const orderNo = db.transaction(
    (tx) => insertOrderWithRetry(tx, product, { email, note, quantity }),
    { behavior: "immediate" }
  );

  try {
    const created = await provider.createPayment({
      orderNo,
      amountCents: totalCents,
      currency: product.currency,
      subject: product.name,
      notifyUrl: `${siteUrl}/api/pay/notify/${provider.name}`,
      redirectUrl: `${siteUrl}/pay/return?order_no=${orderNo}`,
    });
    db.update(orders)
      .set({
        tradeId: created.tradeId,
        expectedActualAmount: created.expectedActualAmount,
        expirationTime: created.expirationTime,
        updatedAt: new Date(),
      })
      .where(eq(orders.orderNo, orderNo))
      .run();
    return {
      orderNo,
      paymentUrl: created.paymentUrl,
      totalCents,
      currency: product.currency,
      expiresAt: created.expirationTime,
      provider: provider.name,
    };
  } catch (err) {
    // 渠道创建失败：补偿关单并回补库存（manual 型），向上抛可读错误
    compensateFailedOrder(orderNo, product);
    throw new OrderError(
      "PAYMENT_FAILED",
      `支付渠道创建失败: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}

function insertOrderWithRetry(
  tx: DbTransaction,
  product: Product,
  data: { email: string; note: string; quantity: number }
): string {
  let lastErr: unknown = null;
  for (let attempt = 0; attempt < 5; attempt++) {
    const orderNo = generateOrderNo();
    try {
      // manual 型库存：条件原子扣减（stockLimit 0 = 不限），受影响行数判定，不超卖
      if (product.deliveryType === "manual" && product.stockLimit > 0) {
        const res = tx
          .update(products)
          .set({ stockLimit: sql`${products.stockLimit} - ${data.quantity}` })
          .where(and(eq(products.id, product.id), sql`${products.stockLimit} >= ${data.quantity}`))
          .run();
        if (res.changes === 0) throw new OrderError("OUT_OF_STOCK", "库存不足");
      }
      tx.insert(orders)
        .values({
          orderNo,
          productId: product.id,
          productName: product.name,
          unitPriceCents: product.priceCents,
          currency: product.currency,
          quantity: data.quantity,
          totalCents: Number(BigInt(product.priceCents) * BigInt(data.quantity)),
          email: data.email,
          note: data.note,
          status: "pending" as OrderStatus,
          stockCharged: product.deliveryType === "manual" && product.stockLimit > 0,
        })
        .run();
      return orderNo;
    } catch (err) {
      lastErr = err;
      if (err instanceof OrderError) throw err;
      // 订单号撞唯一索引 → 换号重试
    }
  }
  throw new OrderError("ORDER_NO_COLLISION", `订单号生成失败: ${String(lastErr)}`);
}

function compensateFailedOrder(orderNo: string, product: Product): void {
  db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
      if (!order || order.status !== "pending") return;
      tx.update(orders)
        .set({ status: "closed" as OrderStatus, updatedAt: new Date() })
        .where(eq(orders.orderNo, orderNo))
        .run();
      getDeliveryStrategy(product.deliveryType).release(tx, order, product);
    },
    { behavior: "immediate" }
  );
}
