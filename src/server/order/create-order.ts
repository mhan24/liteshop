import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { orders, products } from "@/db/schema";
import type { OrderStatus, Product } from "@/db/schema";
import { generateOrderNo } from "@/lib/order-no";
import { getSiteUrl } from "@/server/settings";
import { resolvePaymentProvider } from "@/server/payment";
import { getDeliveryStrategy } from "@/server/delivery";
import { shouldChargeStock } from "@/lib/stock";

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

  const provider = resolvePaymentProvider();
  const siteUrl = getSiteUrl();

  // 建单：IMMEDIATE 事务（auto 型下单即锁定卡密；manual 型条件扣减库存；订单号撞唯一索引重试）
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
        paymentUrl: created.paymentUrl,
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
      // manual 型库存：条件原子扣减（-1 = 不限库存），受影响行数判定，不超卖。
      // 注意：必须用 shouldChargeStock 而非 stockLimit > 0——后者在库存扣到 0 后
      // 会误判为"不限库存"从而跳过校验，导致超卖。
      if (product.deliveryType === "manual" && shouldChargeStock(product.stockLimit)) {
        const res = tx
          .update(products)
          .set({ stockLimit: sql`${products.stockLimit} - ${data.quantity}` })
          .where(and(eq(products.id, product.id), sql`${products.stockLimit} >= ${data.quantity}`))
          .run();
        if (res.changes === 0) throw new OrderError("OUT_OF_STOCK", "库存不足");
      }
      // auto 型：下单即锁定卡密（条件原子占卡，不足即整单回滚）
      if (product.deliveryType === "auto") {
        const claimed = tx.all<{ id: number }>(
          sql`UPDATE cards
              SET status = 'reserved', order_id = ${orderNo}
              WHERE id IN (
                SELECT id FROM cards
                WHERE product_id = ${product.id} AND status = 'available'
                ORDER BY id
                LIMIT ${data.quantity}
              )
              RETURNING id`
        );
        if (claimed.length < data.quantity) {
          throw new OrderError("OUT_OF_STOCK", "库存不足");
        }
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
          stockCharged: product.deliveryType === "manual" && shouldChargeStock(product.stockLimit),
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

/* ===== 继续支付（待支付页）===== */

export interface ResumePaymentResult {
  ok: boolean;
  message: string;
  paymentUrl?: string;
}

/**
 * 继续支付：
 * - pending 且未过期 → 复用已存收银台地址（不轮换 trade_id，避免在途回调验签失败）
 * - 已过期/无地址 → 重新发起（渠道对同单号已失效交易会新建，回调 trade_id 同步更新）
 */
export async function resumeOrderPayment(orderNo: string): Promise<ResumePaymentResult> {
  const order = db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
  if (!order) return { ok: false, message: "订单不存在" };
  if (order.status !== "pending") {
    return { ok: false, message: `订单状态为「${order.status}」，无需继续支付` };
  }

  const notExpired = !order.expirationTime || order.expirationTime.getTime() > Date.now();
  if (order.paymentUrl && notExpired) {
    return { ok: true, message: "ok", paymentUrl: order.paymentUrl };
  }

  const provider = resolvePaymentProvider();
  const siteUrl = getSiteUrl();
  try {
    const created = await provider.createPayment({
      orderNo,
      amountCents: BigInt(order.totalCents),
      currency: order.currency,
      subject: order.productName,
      notifyUrl: `${siteUrl}/api/pay/notify/${provider.name}`,
      redirectUrl: `${siteUrl}/pay/return?order_no=${orderNo}`,
    });
    db.update(orders)
      .set({
        tradeId: created.tradeId,
        expectedActualAmount: created.expectedActualAmount,
        expirationTime: created.expirationTime,
        paymentUrl: created.paymentUrl,
        updatedAt: new Date(),
      })
      .where(eq(orders.orderNo, orderNo))
      .run();
    return { ok: true, message: "已重新发起支付", paymentUrl: created.paymentUrl };
  } catch (err) {
    return {
      ok: false,
      message: `支付渠道创建失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
