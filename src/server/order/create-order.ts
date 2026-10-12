import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { notifyLogs, orders, products } from "@/db/schema";
import type { OrderStatus, Product } from "@/db/schema";
import { generateOrderNo } from "@/lib/order-no";
import { getSiteUrl } from "@/server/settings";
import { resolvePaymentProvider } from "@/server/payment";
import { getDeliveryStrategy } from "@/server/delivery";
import { createAttempt } from "@/server/payment/attempts";
import { sha256Hex } from "@/lib/signature";
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

  let created;
  try {
    created = await provider.createPayment({
      orderNo,
      amountCents: totalCents,
      currency: product.currency,
      subject: product.name,
      notifyUrl: `${siteUrl}/api/pay/notify/${provider.name}`,
      redirectUrl: `${siteUrl}/pay/return?order_no=${orderNo}`,
    });
  } catch (err) {
    // 区分「明确失败」与「结果未知」：
    // 网络超时/中断不代表网关没建单——若此时关单并释放卡密，
    // 网关侧支付地址可能仍然有效，买家付款后无法履约（资损）。
    // 因此结果未知时保留订单为「待对账」，不释放库存。
    if (isUnknownResultError(err)) {
      markOrderUnknown(orderNo, provider.name, err);
      throw new OrderError(
        "PAYMENT_UNKNOWN",
        "支付渠道响应超时，订单已保留待对账。请勿重复支付，稍后可在订单查询页查看状态或联系客服。"
      );
    }
    // 明确失败（参数错误/业务拒绝/HTTP 4xx 等）：补偿关单并回补库存
    compensateFailedOrder(orderNo, product);
    throw new OrderError(
      "PAYMENT_FAILED",
      `支付渠道创建失败: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 交易快照回写 + 记录本次支付尝试（原子）
  db.transaction(
    (tx) => {
      tx.update(orders)
        .set({
          tradeId: created.tradeId,
          expectedActualAmount: created.expectedActualAmount,
          expirationTime: created.expirationTime,
          paymentUrl: created.paymentUrl,
          updatedAt: new Date(),
        })
        .where(eq(orders.orderNo, orderNo))
        .run();
      createAttempt(tx, {
        orderNo,
        provider: provider.name,
        tradeId: created.tradeId,
        amountCents: Number(totalCents),
        currency: product.currency,
        paymentUrl: created.paymentUrl,
        expectedActualAmount: created.expectedActualAmount,
        expirationTime: created.expirationTime,
        raw: created.raw,
      });
    },
    { behavior: "immediate" }
  );

  return {
    orderNo,
    paymentUrl: created.paymentUrl,
    totalCents,
    currency: product.currency,
    expiresAt: created.expirationTime,
    provider: provider.name,
  };
}

/**
 * 判断渠道错误是否属于「结果未知」（网关可能已建单，只是我们没拿到响应）。
 * 这类错误必须与业务拒绝区分：前者不能关单释放库存。
 */
function isUnknownResultError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const name = err.name;
  const msg = err.message;
  // AbortSignal.timeout 触发 TimeoutError；网络层失败为 TypeError
  if (name === "TimeoutError" || name === "AbortError") return true;
  if (/timed? ?out|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed/i.test(msg)) {
    return true;
  }
  return false;
}

/** 结果未知：保留订单但标记为待对账（不释放库存、不关单） */
function markOrderUnknown(orderNo: string, provider: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  db.insert(notifyLogs)
    .values({
      provider,
      orderNo,
      payloadHash: sha256Hex(`unknown:${orderNo}:${Date.now()}`),
      payload: `支付创建结果未知（可能已在网关建单）：${detail}`.slice(0, 2000),
      status: null,
      handled: false,
    })
    .run();
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
 * - 已过期/无地址 → 重新发起，并把新交易登记为「当前有效尝试」
 *
 * 重新发起不会丢弃旧交易：旧尝试保留在 payment_attempts 中（状态置 expired），
 * 其延迟回调将因「非当前尝试」而被拒绝改变订单状态，避免误关已重新支付的订单。
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
  let created;
  try {
    created = await provider.createPayment({
      orderNo,
      amountCents: BigInt(order.totalCents),
      currency: order.currency,
      subject: order.productName,
      notifyUrl: `${siteUrl}/api/pay/notify/${provider.name}`,
      redirectUrl: `${siteUrl}/pay/return?order_no=${orderNo}`,
    });
  } catch (err) {
    // 结果未知时保留原状态（可能有在途交易），不误导买家重复支付
    if (isUnknownResultError(err)) {
      return {
        ok: false,
        message: "支付渠道响应超时，请稍后在订单查询页确认状态，避免重复支付",
      };
    }
    return {
      ok: false,
      message: `支付渠道创建失败: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 条件更新：仅当订单仍是 pending 时才切换交易（防与并发回调节奏错位）
  db.transaction(
    (tx) => {
      const fresh = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
      if (!fresh || fresh.status !== "pending") return;
      tx.update(orders)
        .set({
          tradeId: created.tradeId,
          expectedActualAmount: created.expectedActualAmount,
          expirationTime: created.expirationTime,
          paymentUrl: created.paymentUrl,
          updatedAt: new Date(),
        })
        .where(eq(orders.orderNo, orderNo))
        .run();
      createAttempt(tx, {
        orderNo,
        provider: provider.name,
        tradeId: created.tradeId,
        amountCents: order.totalCents,
        currency: order.currency,
        paymentUrl: created.paymentUrl,
        expectedActualAmount: created.expectedActualAmount,
        expirationTime: created.expirationTime,
        raw: created.raw,
      });
    },
    { behavior: "immediate" }
  );

  return { ok: true, message: "已重新发起支付", paymentUrl: created.paymentUrl };
}
