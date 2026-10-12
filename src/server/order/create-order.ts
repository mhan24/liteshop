import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { notifyLogs, orders, products } from "@/db/schema";
import type { OrderStatus, Product } from "@/db/schema";
import { generateOrderNo } from "@/lib/order-no";
import { getSiteUrl } from "@/server/settings";
import { resolvePaymentProvider, PaymentCreationError } from "@/server/payment";
import { getDeliveryStrategy } from "@/server/delivery";
import { createAttempt } from "@/server/payment/attempts";
import { sha256Hex } from "@/lib/signature";
import { shouldChargeStock } from "@/lib/stock";
import { assertTransition } from "./state-machine";

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
  // 优先使用渠道给出的显式分类（bepusdt 会区分 4xx/5xx 与解析失败）
  if (err instanceof PaymentCreationError) {
    return err.outcome === "unknown";
  }
  // 兜底：非渠道来源的错误仍按网络特征判断
  if (!(err instanceof Error)) return false;
  const name = err.name;
  const msg = err.message;
  // AbortSignal.timeout 触发 TimeoutError；网络层失败为 TypeError
  if (name === "TimeoutError" || name === "AbortError") return true;
  return /timed? ?out|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed|\b5\d\d\b/i.test(
    msg
  );
}

function markOrderUnknown(orderNo: string, provider: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
      if (!order || order.status !== "pending") return;
      // 进入待对账状态，**清除有效期**：绝不能让超时清扫仅凭本地倒计时
      // 释放库存（网关可能已经建单，其支付地址仍然有效）。
      // 库存的释放必须由确认「网关侧无此交易」的动作触发（人工或网关查询）。
      assertTransition("pending", "reconciling");
      tx.update(orders)
        .set({
          status: "reconciling" as OrderStatus,
          expirationTime: null,
          // 收银台地址未知（创建响应丢失），置空避免给买家失效链接
          paymentUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .run();
      tx.insert(notifyLogs)
        .values({
          provider,
          orderNo,
          payloadHash: sha256Hex(`unknown:${orderNo}:${Date.now()}`),
          payload:
            `支付创建结果未知（网关可能已建单），订单进入待对账，库存保持锁定：${detail}`.slice(
              0,
              2000
            ),
          status: null,
          handled: false,
        })
        .run();
    },
    { behavior: "immediate" }
  );
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

/* ===== 重新购买（过期/关闭订单）===== */

/**
 * 依据历史订单创建一笔**全新订单**。
 *
 * 为什么不让过期订单原地恢复为 pending：
 * - 过期时库存已释放（reserved 卡密回到 available、manual 库存已回补），
 *   原地恢复需重新预留，且要与旧交易的延迟回调竞争同一订单；
 * - 旧交易若随后到账，会成为「合法入账路径」，与已释放的库存状态冲突。
 * 新订单走完全相同的安全路径（重新校验库存、重新建立支付尝试）。
 *
 * 双因子：调用方已用订单号 + 邮箱确认归属。
 */
export async function createOrderForRepurchase(
  sourceOrderNo: string,
  email: string
): Promise<CreateOrderResult> {
  const src = db.select().from(orders).where(eq(orders.orderNo, sourceOrderNo)).get();
  if (!src) throw new OrderError("ORDER_NOT_FOUND", "原订单不存在");
  if (src.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new OrderError("INVALID_INPUT", "订单号与邮箱不匹配");
  }
  if (!src.productId) {
    throw new OrderError("PRODUCT_NOT_FOUND", "原商品已删除，请重新选择商品");
  }
  const product = db.select().from(products).where(eq(products.id, src.productId)).get();
  if (!product || product.status !== "on") {
    throw new OrderError("PRODUCT_NOT_FOUND", "原商品已下架，请返回商品列表重新选择");
  }
  return createOrder({
    slug: product.slug,
    email: src.email,
    quantity: src.quantity,
    note: src.note ?? "",
  });
}
