import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { notifyLogs, orders, paymentAnomalies, products } from "@/db/schema";
import type { OrderStatus, Product } from "@/db/schema";
import { generateOrderNo } from "@/lib/order-no";
import { getSiteUrl } from "@/server/settings";
import { resolvePaymentProvider, PaymentCreationError } from "@/server/payment";
import { releaseOrderStock } from "@/server/delivery/release-stock";
import { createAttempt, getLatestAttempt } from "@/server/payment/attempts";
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

  const provider = resolvePaymentProvider();
  const siteUrl = getSiteUrl();
  const startedAt = Date.now();

  // 商品快照与占库建单使用同一写事务，避免独立写入者切换库存模式后
  // 仍按事务外读取的旧模式建单。
  const { orderNo, product } = db.transaction(
    (tx) => {
      const product = tx.select().from(products)
        .where(and(eq(products.slug, input.slug), eq(products.status, "on"))).get();
      if (!product) throw new OrderError("PRODUCT_NOT_FOUND", "商品不存在或已下架");
      return { orderNo: insertOrderWithRetry(tx, product, { email, note, quantity }), product };
    },
    { behavior: "immediate" }
  );
  const totalCents = BigInt(product.priceCents) * BigInt(quantity);

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
    compensateFailedOrder(orderNo);
    throw new OrderError(
      "PAYMENT_FAILED",
      `支付渠道创建失败: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // 交易快照回写 + 记录本次支付尝试（原子）。
  //
  // 竞态防护：创建支付的网络往返期间（上面 await），订单可能已被回调推进
  // （网关在响应返回前就推送了通知）。此时**不能**再无条件写入快照，
  // 否则会把已完成的订单改回「待支付」并留下一条 pending 的支付尝试，
  // 造成订单与支付尝试状态不一致。
  const snapshotWritten = db.transaction(
    (tx) => {
      const fresh = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
      if (!fresh) return false;

      // 订单已进入非待支付状态（paid/delivering/completed/…）→
      // 说明回调已处理，保留回调写入的权威快照，不再覆盖。
      if (fresh.status !== "pending" && fresh.status !== "reconciling") {
        return false;
      }

      // 已有更新的支付尝试（例如 resume 场景）→ 不覆盖当前交易
      const existing = getLatestAttempt(orderNo, tx);
      if (existing && existing.createdAt && existing.createdAt.getTime() > startedAt) {
        return false;
      }

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
      return true;
    },
    { behavior: "immediate" }
  );

  if (!snapshotWritten) {
    // 订单已被其它路径推进：以数据库中的权威状态为准，不返回本地的陈旧快照
    const fresh = db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
    return {
      orderNo,
      paymentUrl: fresh?.paymentUrl ?? created.paymentUrl,
      totalCents,
      currency: product.currency,
      expiresAt: fresh?.expirationTime ?? created.expirationTime,
      provider: provider.name,
    };
  }

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
export function isUnknownResultError(err: unknown): boolean {
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
  if (/timed? ?out|timeout|ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|socket hang up|fetch failed|\b5\d\d\b/i.test(msg)) {
    return true;
  }
  // 响应解析/结构类异常（如 "Cannot read properties of null"）：
  // 说明网关回了**能解析但不符合预期**的报文。HTTP 200 + 合法 JSON
  // 并不能证明未建单，因此按 unknown 处理（保留待对账），
  // 而不是当成"明确失败"去补偿关单、释放库存。
  if (/Cannot read propert|is not a function|Unexpected token|Invalid JSON|JSON/i.test(msg)) {
    return true;
  }
  return false;
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
    // 每次尝试包一个 SAVEPOINT：订单号撞唯一索引时需要回滚**本次尝试的全部副作用**
    // （库存扣减、卡密占用），否则重试会在已扣减的基础上再扣一次，
    // 造成库存凭空减少（实测 10 → 9 → 8，只该扣 1）。
    // 普通语句失败只回滚该语句，不会撤销同一事务内先前成功的 UPDATE，
    // 因此必须显式使用保存点。
    const SAVEPOINT = `order_attempt_${attempt}`;
    tx.run(sql.raw(`SAVEPOINT ${SAVEPOINT}`));
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
          // 发货方式快照：后续履约/释放以此为准，不受商品被改类型影响
          deliveryType: product.deliveryType,
          stockCharged: product.deliveryType === "manual" && shouldChargeStock(product.stockLimit),
        })
        .run();
      tx.run(sql.raw(`RELEASE ${SAVEPOINT}`));
      return orderNo;
    } catch (err) {
      lastErr = err;
      // 无论何种失败，先回滚本次尝试的副作用（库存扣减/卡密占用）
      tx.run(sql.raw(`ROLLBACK TO ${SAVEPOINT}`));
      tx.run(sql.raw(`RELEASE ${SAVEPOINT}`));
      if (err instanceof OrderError) throw err;
      // 仅对「订单号唯一索引冲突」重试。
      // 早期做法是把所有非 OrderError 都当重试条件，导致 DB I/O 错误、
      // 其它约束冲突等不可恢复异常也被连续重试 5 次，
      // 最后统一报成 ORDER_NO_COLLISION —— 掩盖真实故障且放大 DB 压力。
      if (!isOrderNoCollision(err)) throw err;
    }
  }
  throw new OrderError("ORDER_NO_COLLISION", `订单号生成失败: ${String(lastErr)}`);
}

/**
 * 是否为 `orders.order_no` 唯一索引冲突。
 *
 * better-sqlite3 的 SQLITE_CONSTRAINT_UNIQUE 会带消息：
 *   "UNIQUE constraint failed: orders.order_no"
 * 据此精确匹配，避免把其它约束/IO 错误误判为可重试冲突。
 *
 * 导出以便单独测试（纯函数），避免"测试只复制了判别条件"却未覆盖真实调用路径。
 */
export function isOrderNoCollision(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const code = (err as { code?: string }).code;
  const msg = err.message ?? "";
  if (code !== "SQLITE_CONSTRAINT_UNIQUE" && code !== "SQLITE_CONSTRAINT_PRIMARYKEY") return false;
  return /orders\.order_no|order_no/.test(msg);
}

function compensateFailedOrder(orderNo: string): void {
  db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
      if (!order || order.status !== "pending") return;
      tx.update(orders)
        .set({ status: "closed" as OrderStatus, updatedAt: new Date() })
        .where(eq(orders.orderNo, orderNo))
        .run();
      releaseOrderStock(tx, order.orderNo);
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
/**
 * 允许重新购买的原订单状态 —— **白名单**（唯一真相）。
 *
 * 只有已终结且未支付的订单才能重购：
 * - expired / closed：交易已失效或已关闭，重购不会与在途交易冲突
 *
 * 明确**不允许**：
 * - pending      ：仍在待支付，应直接继续支付（重购会重复占用库存）
 * - reconciling  ：支付结果未知，网关可能已建单、买家可能已付款；
 *                  此时重购会再次占用库存，且买家可能为同一笔订单重复付款
 * - paid / delivering / completed：已付款或已交付
 *
 * 白名单（而非黑名单）可避免将来新增状态时被静默放行。
 */
export const REPURCHASE_ALLOWED_STATUSES = ["expired", "closed"] as const;

export function canRepurchase(status: string): boolean {
  return (REPURCHASE_ALLOWED_STATUSES as readonly string[]).includes(status);
}

/**
 * 重购前必须排除的两类「钱的问题」：
 *
 * 1. **已收款**（`paidAt` 非空）：状态机允许 paid → closed，
 *    所以仅凭 status 无法判断是否收过钱。已付款的订单若允许重购，
 *    会误导买家再次支付（虽不会自动重复扣款）。
 * 2. **有未处理的异常到账**（payment_anomalies.status = 'open'）：
 *    超时订单收到延迟的成功回调时会登记为待人工处置。
 *    此时买家是否付款尚未核实，允许重购会让买家重复付款。
 */
export function repurchaseBlockedReason(
  order: { status: string; paidAt: Date | null },
  hasOpenAnomaly: boolean
): string | null {
  if (order.paidAt !== null) {
    return "该订单已付款或尚未结束，请联系客服处理";
  }
  if (hasOpenAnomaly) {
    return "该订单有一笔待核实的到账记录，为避免重复付款，请联系客服";
  }
  return null;
}

export async function createOrderForRepurchase(
  sourceOrderNo: string,
  email: string
): Promise<CreateOrderResult> {
  const src = db.select().from(orders).where(eq(orders.orderNo, sourceOrderNo)).get();
  if (!src) throw new OrderError("ORDER_NOT_FOUND", "原订单不存在");
  if (src.email.trim().toLowerCase() !== email.trim().toLowerCase()) {
    throw new OrderError("INVALID_INPUT", "订单号与邮箱不匹配");
  }
  // 服务层兜底校验：任何调用入口（含将来的新入口）都必须满足白名单，
  // 不能只依赖前端按钮或 Action 的判断。
  if (!canRepurchase(src.status)) {
    throw new OrderError(
      "INVALID_STATUS",
      src.status === "reconciling"
        ? "该订单支付状态待核实，请勿重复下单，请联系客服"
        : `订单状态为「${src.status}」，无法重新购买`
    );
  }

  // 收款/异常到账校验（不能只靠 status，见 repurchaseBlockedReason）
  const hasOpenAnomaly = db
    .select({ id: paymentAnomalies.id })
    .from(paymentAnomalies)
    .where(
      and(
        eq(paymentAnomalies.orderNo, sourceOrderNo),
        eq(paymentAnomalies.status, "open")
      )
    )
    .get();
  const blocked = repurchaseBlockedReason(src, !!hasOpenAnomaly);
  if (blocked) {
    throw new OrderError("ALREADY_PAID", blocked);
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
