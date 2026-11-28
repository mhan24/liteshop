import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import {
  auditLogs,
  deliveries,
  notifyLogs,
  orderItems,
  orders,
  payments,
  products,
} from "@/db/schema";
import { generateOrderNo } from "@/lib/order-no";
import { generateQueryPassword, hashQueryPassword, verifyQueryPassword } from "@/lib/query-password";
import { sha256Hex } from "@/lib/litepay-sign";
import { toMinorUnits } from "@/lib/money";
import { releaseStock, reserveStock, sellOrderCards } from "./catalog";
import type { Tx } from "./db-tx";
import { type ActiveGateway, getActiveGateway, getAdapter, getGatewayByType, webhookPath } from "./payments";
import { litepayCashierUrl } from "./payments/litepay";
import type { CreateOutcome, GatewayType, NotifyPayload } from "./payments/types";
import { getConfig, getSiteUrl } from "./settings";
import { notifyLatePayment, notifyLowStockCrossings, notifyPaidUndelivered, notifyReconciling } from "./notify";

/**
 * 订单服务：创建、支付回调确认、状态机、原子发卡、过期清扫。
 *
 * 站点只有一种履约方式：卡密自动发货。支付走单一 LitePay 网关。
 *
 * 安全不变量：
 * - 金额永远由服务端按商品价格计算，买家输入只含 slug + 数量
 * - 履约只信**验签通过的服务端回调**；前端回跳仅用于展示
 * - 卡密分配在数据库事务内完成（FOR UPDATE SKIP LOCKED），一卡不会两卖
 * - 回调幂等：payments(channel, provider_ref) 唯一 + notify_logs(payload_hash) 去重
 * - 创建结果未知（超时/5xx）→ reconciling，绝不释放库存（网关可能已建单）
 */

export class OrderError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

/* ================= 状态机 ================= */

const TRANSITIONS: Record<string, readonly string[]> = {
  pending: ["paid", "closed", "reconciling"],
  reconciling: ["paid", "closed"],
  paid: ["completed"],
  completed: [],
  closed: [],
};

export function assertTransition(from: string, to: string): void {
  if (!(TRANSITIONS[from] ?? []).includes(to)) {
    throw new OrderError("INVALID_TRANSITION", `非法状态迁移: ${from} → ${to}`);
  }
}

/* ================= 下单 ================= */

export interface CheckoutItemInput {
  slug: string;
  quantity: number;
}

export interface CreateOrderInput {
  email: string;
  items: CheckoutItemInput[];
  note?: string;
}

export interface CreateOrderResult {
  orderNo: string;
  queryPassword: string;
  totalCents: number;
  status: string;
  paymentUrl: string | null;
  reconciling: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new OrderError("INVALID_INPUT", "请输入有效的下单邮箱");
  }
  // 同一 slug 合并为一行（否则同一商品会分两次锁卡、两段交付）
  const merged = new Map<string, number>();
  for (const i of input.items) {
    const slug = i.slug.trim();
    const quantity = i.quantity;
    if (!slug || !Number.isInteger(quantity) || quantity < 1 || quantity > 99) {
      throw new OrderError("INVALID_INPUT", "请检查商品及数量，每件商品可购买 1–99 件");
    }
    merged.set(slug, (merged.get(slug) ?? 0) + quantity);
  }
  const items = [...merged].map(([slug, quantity]) => ({ slug, quantity }));
  if (items.length === 0 || items.length > 20) {
    throw new OrderError("INVALID_INPUT", "购物车为空或商品种类超过上限（最多 20 种）");
  }
  if (items.some((i) => i.quantity < 1 || i.quantity > 99)) {
    throw new OrderError("INVALID_INPUT", "单件商品购买数量需在 1–99 之间");
  }
  // 网关没配置就不要建单：否则会留下占着卡密却无法付款的僵尸订单
  const gateway = await getActiveGateway();
  if (!gateway) {
    throw new OrderError("NO_PAYMENT_CHANNEL", "收款通道暂不可用，请稍后再试或联系客服");
  }
  const note = input.note?.trim().slice(0, 500) ?? "";
  // 事务外读配置：事务内不得再向连接池借连接（见 notifyLowStockCrossings）
  const { lowStockThreshold } = await getConfig();
  const siteUrl = await getSiteUrl();
  const queryPassword = generateQueryPassword();
  const passwordHash = await hashQueryPassword(queryPassword);

  // 1) 事务：加载商品快照 → 建订单 + 明细 → 锁卡（订单号冲突整体重试）
  let created: {
    orderId: string;
    orderNo: string;
    totalCents: number;
    itemRows: PendingItemRow[];
  } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      created = await db.transaction(async (tx) => {
        const itemRows: Array<PendingItemRow & { unitPriceCents: number; lineTotalCents: number }> = [];
        let subtotal = 0;
        // 共享锁允许并发下单，阻止快照读取后商品被下架或删除。
        const snapshots = await tx.select().from(products)
          .where(inArray(products.slug, items.map((item) => item.slug)))
          .orderBy(asc(products.id)).for("share");
        const bySlug = new Map(snapshots.map((p) => [p.slug, p]));
        for (const item of items) {
          const p = bySlug.get(item.slug);
          if (!p || p.status !== "on") throw new OrderError("PRODUCT_NOT_FOUND", "商品不存在或已下架");
          const lineTotal = p.priceCents * item.quantity;
          subtotal += lineTotal;
          itemRows.push({
            productId: p.id,
            productName: p.name,
            quantity: item.quantity,
            unitPriceCents: p.priceCents,
            lineTotalCents: lineTotal,
          });
        }

        const orderNo = generateOrderNo();
        const inserted = await tx
          .insert(orders)
          .values({
            orderNo,
            email,
            queryPasswordHash: passwordHash,
            status: "pending",
            subtotalCents: subtotal,
            totalCents: subtotal,
            note: note || null,
            expiresAt: null,
          })
          .returning({ id: orders.id, orderNo: orders.orderNo });
        const order = inserted[0]!;
        await tx.insert(orderItems).values(
          itemRows.map((r) => ({
            orderId: order.id,
            productId: r.productId,
            productName: r.productName,
            unitPriceCents: r.unitPriceCents,
            quantity: r.quantity,
            lineTotalCents: r.lineTotalCents,
          }))
        );
        const reserved = itemRows.map((r) => ({ productId: r.productId, quantity: r.quantity }));
        await reserveStock(tx, order.id, reserved);
        await notifyLowStockCrossings(tx, reserved, lowStockThreshold);
        return { orderId: order.id, orderNo: order.orderNo, totalCents: subtotal, itemRows };
      });
      break;
    } catch (err) {
      if (isOrderNoCollision(err)) continue;
      if (err instanceof Error && err.message === "OUT_OF_STOCK") {
        throw new OrderError("OUT_OF_STOCK", "商品库存不足，请调整数量后再提交");
      }
      throw err;
    }
  }
  if (!created) throw new OrderError("ORDER_NO_COLLISION", "订单号生成失败");

  // 2) 网关建单（网络调用在库存事务之外）
  const outcome = await startPaymentAttempt({
    gateway,
    siteUrl,
    orderId: created.orderId,
    orderNo: created.orderNo,
    amountCents: created.totalCents,
    subject: created.itemRows.map((r) => r.productName).join(" + "),
  });

  if (outcome.kind === "rejected") {
    const status = await closeOrderInternal(created.orderId, created.orderNo, outcome.message);
    if (status === "closed") throw new OrderError("PAYMENT_FAILED", `创建支付失败：${outcome.message}`);
    return { orderNo: created.orderNo, queryPassword, totalCents: created.totalCents, status,
      paymentUrl: null, reconciling: status === "reconciling" };
  }
  if (outcome.kind === "unknown") {
    const status = await markReconciling(created.orderId, outcome.message);
    return {
      orderNo: created.orderNo,
      queryPassword,
      totalCents: created.totalCents,
      status,
      paymentUrl: null,
      reconciling: status === "reconciling",
    };
  }
  return {
    orderNo: created.orderNo,
    queryPassword,
    totalCents: created.totalCents,
    status: outcome.kind === "inactive" ? outcome.status : "pending",
    paymentUrl: outcome.kind === "inactive" ? null : outcome.payment.paymentUrl,
    reconciling: outcome.kind === "inactive" && outcome.status === "reconciling",
  };
}

function isOrderNoCollision(err: unknown): boolean {
  const cause = err instanceof Error && err.cause ? err.cause : err;
  return typeof cause === "object" && cause !== null &&
    "code" in cause && cause.code === "23505" &&
    "constraint" in cause && cause.constraint === "orders_order_no_unique";
}

async function markReconciling(orderId: string, reason: string): Promise<string> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    const order = rows[0];
    if (!order || order.status !== "pending") return order?.status ?? "closed";
    await markReconcilingInTx(tx, order, reason);
    return "reconciling";
  });
}

async function markReconcilingInTx(tx: Tx, order: typeof orders.$inferSelect, reason: string): Promise<void> {
  assertTransition(order.status, "reconciling");
  await tx.update(orders)
    .set({ status: "reconciling", expiresAt: null, updatedAt: new Date() })
    .where(eq(orders.id, order.id));
  await notifyReconciling(tx, order.orderNo, order.totalCents, reason);
}

interface PendingItemRow {
  productId: number;
  productName: string;
  quantity: number;
}

type AttemptOutcome =
  | { kind: "inactive"; status: string; message: string }
  | { kind: "created"; payment: { paymentUrl: string | null; expiresAt: Date | null } }
  | { kind: "rejected"; message: string }
  | { kind: "unknown"; message: string };

/**
 * 为订单发起一次支付尝试（新建订单或重新支付共用）。
 *
 * 异常安全：pending 支付记录落库之后的任何异常（网关适配器抛错、回填失败）都按
 * unknown 处理——网关可能已建单，订单必须进入 reconciling，而不是停在
 * 「pending + 无有效期」这种清扫永远扫不到、卡密永久占用的状态。
 */
async function startPaymentAttempt(input: {
  gateway: ActiveGateway | null;
  siteUrl: string;
  orderId: string;
  orderNo: string;
  amountCents: number;
  subject: string;
}): Promise<AttemptOutcome> {
  const { siteUrl: base } = input;
  // 先落一条 pending 支付记录（作废旧尝试），让「unknown」也有归属。
  // 订单行锁 + 状态复核：并发的「重新支付」/回调/关单不会与本次尝试交错。
  const attempt = await db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for("update");
    const order = rows[0];
    if (!order || order.status !== "pending" || (order.expiresAt && order.expiresAt.getTime() <= Date.now())) {
      return { kind: "inactive" as const, status: order?.status ?? "closed", message: "订单已结束付款" };
    }
    // LitePay 以商户订单号幂等建单。撤销后再发同一个订单号仍会得到原交易。
    const [existing] = await tx.select().from(payments).where(and(
      eq(payments.orderId, order.id), eq(payments.isCurrent, true), eq(payments.channel, "litepay"),
    )).limit(1);
    if (existing) {
      const paymentUrl = litepayCashierUrl(existing.paymentUrl, existing.providerRef, input.gateway?.runtime.apiBase);
      if (existing.status === "pending" && paymentUrl && existing.expiresAt && existing.expiresAt.getTime() > Date.now()) {
        return { kind: "created" as const, payment: { paymentUrl, expiresAt: existing.expiresAt } };
      }
      return { kind: "inactive" as const, status: order.status, message: "付款链接暂不可用，请查看订单状态" };
    }
    const gateway = input.gateway;
    if (!gateway) return { kind: "rejected" as const, message: "支付网关未配置或已停用" };
    const superseded = await tx
      .update(payments)
      .set({ isCurrent: false, status: "expired", updatedAt: new Date() })
      .where(and(eq(payments.orderId, input.orderId), eq(payments.isCurrent, true)))
      .returning({ channel: payments.channel, providerRef: payments.providerRef });
    const inserted = await tx
      .insert(payments)
      .values({
        orderId: input.orderId,
        channel: gateway.type,
        status: "pending",
        isCurrent: true,
        amountCents: input.amountCents,
      })
      .returning({ id: payments.id });
    return { kind: "reserved" as const, gateway, paymentId: inserted[0]!.id, superseded };
  });
  if (attempt.kind !== "reserved") return attempt;
  const { gateway } = attempt;
  const adapter = getAdapter(gateway.type);
  // 旧交易通知网关撤销（best-effort）；若买家仍向旧交易付款，回调会记为 late 人工核对
  for (const o of attempt.superseded) {
    if (o.providerRef) cancelAtGateway(o.channel, o.providerRef, "supersede");
  }

  let outcome: CreateOutcome;
  try {
    outcome = await adapter.createPayment(gateway.runtime, {
      orderNo: input.orderNo,
      amountCents: input.amountCents,
      subject: input.subject,
      notifyUrl: `${base}${webhookPath(gateway.type)}`,
      redirectUrl: `${base}/pay/${input.orderNo}`,
    });
  } catch (err) {
    outcome = { kind: "unknown", message: `网关调用异常: ${err instanceof Error ? err.message : String(err)}` };
  }

  if (outcome.kind === "created") {
    const created = outcome.payment;
    try {
      const state = await db.transaction(async (tx) => {
        // 锁顺序与建尝试时一致：先订单行，再支付行（避免 40P01 死锁）
        const rows = await tx
          .select()
          .from(orders)
          .where(eq(orders.id, input.orderId))
          .limit(1)
          .for("update");
        // 按 id 回填本次尝试：并发「重新支付」可能已把它作废，绝不能写到更新的尝试上
        const updated = await tx
          .update(payments)
          .set({
            providerRef: created.providerRef,
            paymentUrl: created.paymentUrl,
            expectedAmount: created.expectedAmount,
            expiresAt: created.expiresAt,
            raw: (created.raw ?? null) as never,
            updatedAt: new Date(),
          })
          .where(and(eq(payments.id, attempt.paymentId), or(
            isNull(payments.providerRef),
            created.providerRef ? eq(payments.providerRef, created.providerRef) : undefined,
          )))
          .returning({ isCurrent: payments.isCurrent });
        if (!updated.length) throw new Error("建单响应与已绑定的交易号不符");
        if (rows[0]?.status === "pending" && updated[0]?.isCurrent) {
          await tx
            .update(orders)
            .set({ expiresAt: created.expiresAt, updatedAt: new Date() })
            .where(eq(orders.id, input.orderId));
        }
        return { status: rows[0]?.status ?? "closed", current: updated[0]?.isCurrent };
      });
      if (state.status !== "pending" || !state.current) {
        if (created.providerRef && (state.status === "closed" || !state.current)) {
          cancelAtGateway(gateway.type, created.providerRef, "closed-during-create");
        }
        return { kind: "inactive", status: state.status, message: "订单状态已更新，请查看订单" };
      }
    } catch (err) {
      console.error("[payment] 网关已建单但回填失败，转对账", err);
      return { kind: "unknown", message: "网关已建单但本地记录失败" };
    }
    return { kind: "created", payment: { paymentUrl: created.paymentUrl, expiresAt: created.expiresAt } };
  }

  if (outcome.kind === "closed") {
    const status = await db.transaction(async (tx) => {
      const order = await lockOrderByNo(tx, input.orderNo);
      if (!order || order.status !== "pending") return order?.status ?? "closed";
      const recorded = await tx.update(payments)
        .set({ providerRef: outcome.providerRef, updatedAt: new Date() })
        .where(and(eq(payments.id, attempt.paymentId), eq(payments.isCurrent, true), eq(payments.status, "pending"),
          or(isNull(payments.providerRef), eq(payments.providerRef, outcome.providerRef))))
        .returning({ id: payments.id });
      if (!recorded.length) return order.status;
      await closePendingInTx(tx, order);
      return "closed";
    });
    return { kind: "inactive", status, message: outcome.message };
  }

  // rejected：本次尝试作废；unknown：保持 pending（网关可能已建单，等回调认领或人工核对）
  if (outcome.kind === "rejected") {
    await db
      .update(payments)
      .set({ status: "failed", updatedAt: new Date() })
      .where(and(eq(payments.id, attempt.paymentId), eq(payments.status, "pending")));
  }
  return outcome;
}

/** 通知网关撤销未到账交易（best-effort，不阻塞调用方） */
function cancelAtGateway(channel: GatewayType, providerRef: string, tag: string): void {
  const adapter = getAdapter(channel);
  if (!adapter.cancelPayment) return;
  void getGatewayByType(channel)
    .then((gateway) => adapter.cancelPayment!(gateway, providerRef))
    .then((r) => console.log(`[cancel:${tag}] ${channel} ${providerRef} ok=${r.ok} ${r.message}`))
    .catch((err) => console.warn(`[cancel:${tag}] ${channel} ${providerRef} failed`, err));
}

/**
 * 关闭 pending 订单（事务内，调用方已持有订单行锁）：订单 closed、当前支付作废、释放卡密。
 * 返回需要通知网关撤销的交易（无则 null）。
 */
async function closePendingInTx(
  tx: Tx,
  order: { id: string; status: string }
): Promise<{ channel: GatewayType; providerRef: string } | null> {
  assertTransition(order.status, "closed");
  await tx.update(orders).set({ status: "closed", updatedAt: new Date() }).where(eq(orders.id, order.id));
  const expired = await tx
    .update(payments)
    .set({ status: "expired", updatedAt: new Date() })
    .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true), eq(payments.status, "pending")))
    .returning({ channel: payments.channel, providerRef: payments.providerRef });
  await releaseStock(tx, order.id);
  const ref = expired[0];
  return ref?.providerRef ? { channel: ref.channel, providerRef: ref.providerRef } : null;
}

async function lockOrderByNo(tx: Tx, orderNo: string) {
  const rows = await tx.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1).for("update");
  return rows[0] ?? null;
}

/** 明确拒绝：补偿关单并释放卡密 */
async function closeOrderInternal(orderId: string, orderNo: string, reason: string): Promise<string> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    const order = rows[0];
    if (!order || order.status !== "pending") return order?.status ?? "closed";
    await closePendingInTx(tx, order);
    await tx.insert(notifyLogs).values({
      channel: "internal",
      orderNo,
      payloadHash: sha256Hex(`rejected:${orderNo}:${reason}:${Date.now()}`),
      payload: `网关建单被拒绝，订单已关闭并释放卡密：${reason}`.slice(0, 2000),
      handled: true,
    });
    return "closed";
  });
}

/* ================= 支付回调（webhook） ================= */

export interface WebhookResult {
  respond: "success" | "fail";
  handled: boolean;
  message: string;
}

export async function handlePaymentWebhook(channel: GatewayType, rawBody: string): Promise<WebhookResult> {
  const gateway = await getGatewayByType(channel);
  const adapter = getAdapter(channel);
  const verification = adapter.verifyNotify(gateway, rawBody);

  if (!verification.ok || !verification.payload) {
    // 未认证请求不落库（防写满磁盘），只留一行日志
    console.warn(`[webhook] ${channel} 拒绝: ${verification.error ?? "验签失败"}`);
    return { respond: channel === "litepay" ? "fail" : "success", handled: false, message: verification.error ?? "验签失败" };
  }
  const payload = verification.payload;
  const payloadHash = sha256Hex(rawBody);

  try {
    await db.insert(notifyLogs).values({
      channel,
      orderNo: payload.orderNo,
      providerRef: payload.providerRef,
      payloadHash,
      payload: rawBody.slice(0, 10_000),
      handled: false,
    });
  } catch (err) {
    console.error("[webhook] 通知日志写入失败", err);
    return { respond: "fail", handled: false, message: "internal" };
  }

  try {
    return await db.transaction(async (tx) => {
      const seen = await tx
        .select({ id: notifyLogs.id })
        .from(notifyLogs)
        .where(and(eq(notifyLogs.payloadHash, payloadHash), eq(notifyLogs.handled, true)))
        .limit(1);
      if (seen[0]) {
        return { respond: "success" as const, handled: true, message: "重复通知" };
      }
      return processWebhook(tx, channel, payload, payloadHash);
    });
  } catch (err) {
    console.error("[webhook] 处理异常", err);
    return { respond: "fail", handled: false, message: "internal" };
  }
}

async function processWebhook(
  tx: Tx,
  channel: GatewayType,
  payload: NotifyPayload,
  payloadHash: string
): Promise<WebhookResult> {
  const unaccepted = channel === "litepay" ? "fail" : "success";
  const markHandled = async (handled: boolean) => {
    await tx.update(notifyLogs).set({ handled }).where(eq(notifyLogs.payloadHash, payloadHash));
  };

  // LitePay 只会发成功通知；其它 status 属于别的 BEpusdt 网关语义，记录后忽略
  if (payload.status !== 2) {
    await markHandled(true);
    return { respond: "success", handled: true, message: `非成功通知（status=${payload.status}），已忽略` };
  }

  const orderRows = await tx
    .select()
    .from(orders)
    .where(eq(orders.orderNo, payload.orderNo))
    .limit(1)
    .for("update");
  const order = orderRows[0];
  if (!order) {
    await markHandled(false);
    return { respond: unaccepted, handled: false, message: "订单不存在" };
  }

  // 定位支付记录：优先 (channel, providerRef)
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.channel, channel), eq(payments.providerRef, payload.providerRef)))
    .limit(1);
  let payment = paymentRows[0];

  // 响应丢失时先核对渠道与金额，再把已验签的交易号绑定到当前尝试。
  // 已关闭的订单也保留晚到账的证据，交给下方的人工核对分支。
  if (!payment) {
    const [current] = await tx.select().from(payments).where(and(
      eq(payments.orderId, order.id), eq(payments.channel, channel), eq(payments.isCurrent, true),
      sql`provider_ref is null`,
    )).limit(1);
    payment = current;
  }

  if (!payment || payment.orderId !== order.id) {
    await markHandled(false);
    return { respond: unaccepted, handled: false, message: "交易不属于当前订单" };
  }

  if (payload.amount == null) {
    await markHandled(false);
    return { respond: unaccepted, handled: false, message: "回调缺少金额字段" };
  }
  let amountMinor: number;
  try {
    amountMinor = toMinorUnits(payload.amount);
  } catch {
    await markHandled(false);
    return { respond: unaccepted, handled: false, message: "回调金额非法" };
  }
  if (amountMinor !== order.totalCents) {
    await markHandled(false);
    return { respond: unaccepted, handled: false, message: `金额不匹配: ${String(payload.amount)}` };
  }
  if (
    payment.expectedAmount &&
    (!payload.actualAmount || normalizeAmount(payload.actualAmount) !== normalizeAmount(payment.expectedAmount))
  ) {
    await markHandled(false);
    return { respond: unaccepted, handled: false, message: "actual_amount 与快照不匹配" };
  }

  if (payment.providerRef === null) {
    await tx.update(payments).set({ providerRef: payload.providerRef, updatedAt: new Date() })
      .where(eq(payments.id, payment.id));
  }

  if (payment.status === "confirmed") {
    await markHandled(true);
    return { respond: "success", handled: true, message: "该交易已确认（幂等）" };
  }

  // 订单已终结/已由其它交易完成/非当前尝试 → 延迟到账，登记对账特例
  if (order.status === "closed" || order.status === "completed" || !payment.isCurrent) {
    // 网关重复推送同一笔延迟到账时只通知一次
    if (payment.status !== "late") {
      await notifyLatePayment(tx, order.orderNo, payment.providerRef ?? payload.providerRef, String(payload.amount));
    }
    await tx
      .update(payments)
      .set({ status: "late", anomaly: "late", confirmedAt: new Date(), updatedAt: new Date() })
      .where(eq(payments.id, payment.id));
    await markHandled(false);
    return { respond: "success", handled: false, message: "延迟到账，已登记待人工核对" };
  }

  // pending / reconciling → paid
  if (order.status === "pending" || order.status === "reconciling") {
    assertTransition(order.status, "paid");
    await tx
      .update(orders)
      .set({ status: "paid", paidAt: new Date(), expiresAt: null, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
  }

  await tx
    .update(payments)
    .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
    .where(eq(payments.id, payment.id));

  const delivered = await deliverOrder(tx, order.id);
  if (!delivered) await notifyPaidUndelivered(tx, order.orderNo);
  await markHandled(true);
  return delivered
    ? { respond: "success", handled: true, message: "已确认支付并发放卡密" }
    : { respond: "success", handled: false, message: "已确认支付，但卡密不足，待人工处理" };
}

function normalizeAmount(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v.trim();
}

/**
 * 自动发卡：reserved → sold，写入交付记录（deliveries.order_id 唯一 = 数据库级幂等）。
 * 卡密数量不足（例如后台删了已锁定的卡）时保留 paid，等补货后重试。
 */
export async function deliverOrder(tx: Tx, orderId: string): Promise<boolean> {
  const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
  const order = orderRows[0];
  if (!order) return false;
  if (order.status === "completed") return true;
  if (order.status !== "paid") return false;

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const sold = await sellOrderCards(tx, orderId, items);
  if (!sold) return false;

  await tx.insert(deliveries).values({
    orderId,
    content: buildDeliveryContent(items, sold),
    cardIds: sold.map((c) => c.id),
  });

  assertTransition(order.status, "completed");
  await tx
    .update(orders)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  return true;
}

function buildDeliveryContent(
  items: Array<{ productId: number | null; productName: string; quantity: number }>,
  sold: Array<{ id: number; content: string; productId: number }>
): string {
  const byProduct = new Map<number, string[]>();
  for (const c of sold) {
    const list = byProduct.get(c.productId) ?? [];
    list.push(c.content);
    byProduct.set(c.productId, list);
  }
  // 同一商品出现在多行明细时按数量依次切分，避免同一张卡在多段重复出现
  return items
    .flatMap((item) => {
      if (item.productId === null) return [];
      const contents = (byProduct.get(item.productId) ?? []).splice(0, item.quantity);
      return contents.length ? [`【${item.productName}】\n${contents.join("\n")}`] : [];
    })
    .join("\n\n");
}

/* ================= 过期清扫 ================= */

export interface SweepResult {
  closedOrders: string[];
}

/** 关闭过期 pending 订单并释放卡密；同步作废过期支付记录并通知网关撤销 */
export async function sweepExpired(limit = 200): Promise<SweepResult> {
  const cancels: Array<{ channel: GatewayType; providerRef: string }> = [];
  const closed = await db.transaction(async (tx) => {
    const now = new Date();
    // 建单请求限时 15 秒。进程中断会留下没有有效期的订单，保留卡密等待核对。
    const stalledBefore = new Date(now.getTime() - 2 * 60_000);
    const candidates = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.status, "pending"), or(
        lt(orders.expiresAt, now),
        and(isNull(orders.expiresAt), lt(orders.updatedAt, stalledBefore)),
      )))
      .orderBy(asc(orders.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    const closed: string[] = [];
    for (const order of candidates) {
      if (!order.expiresAt) {
        await markReconcilingInTx(tx, order, "支付建单中断，未能确认网关订单状态");
        continue;
      }
      const ref = await closePendingInTx(tx, order);
      if (ref) cancels.push(ref);
      closed.push(order.orderNo);
    }
    return closed;
  });
  for (const c of cancels) cancelAtGateway(c.channel, c.providerRef, "sweep");
  return { closedOrders: closed };
}

/* ================= 买家操作 ================= */

/**
 * 买家侧敏感操作的身份校验：订单号 + 邮箱 + 查单密码三因子（与订单查询同一口径）。
 * 订单号会出现在收银台回跳地址里，邮箱也可能被他人知道——两者都不足以授权改动订单。
 */
async function authenticateBuyer(orderNo: string, email: string, password: string) {
  const no = orderNo.trim();
  const mail = email.trim().toLowerCase();
  if (!no || !mail || !password.trim()) return null;
  const rows = await db
    .select()
    .from(orders)
    .where(and(eq(orders.orderNo, no), eq(orders.email, mail)))
    .limit(1);
  const order = rows[0];
  const ok = await verifyQueryPassword(order?.queryPasswordHash ?? null, password);
  return order && ok ? order : null;
}

/** 买家取消 pending 订单；同步通知网关撤销 */
export async function cancelPendingOrder(
  orderNo: string,
  email: string,
  password: string
): Promise<{ ok: boolean; message: string }> {
  const order = await authenticateBuyer(orderNo, email, password);
  if (!order) return { ok: false, message: "订单不存在，或下单邮箱与查单密码不匹配" };
  const result = await db.transaction(async (tx) => {
    const locked = await lockOrderByNo(tx, order.orderNo);
    if (locked?.status !== "pending") return { closed: false as const };
    return { closed: true as const, ref: await closePendingInTx(tx, locked) };
  });
  if (!result.closed) return { ok: false, message: "订单当前状态不可取消" };
  if (result.ref) cancelAtGateway(result.ref.channel, result.ref.providerRef, "buyer");
  return { ok: true, message: "订单已取消，占用的卡密已退回库存" };
}

/** 待支付订单继续付款；LitePay 复用尚在有效期的原交易。 */
export async function resumePayment(
  orderNo: string,
  email: string,
  password: string
): Promise<{ ok: boolean; message: string; data?: { paymentUrl: string | null } }> {
  const order = await authenticateBuyer(orderNo, email, password);
  if (!order) return { ok: false, message: "订单不存在，或下单邮箱与查单密码不匹配" };
  if (order.status !== "pending") return { ok: false, message: "订单不在待支付状态" };
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  if (items.length === 0) return { ok: false, message: "订单缺少商品明细" };
  const outcome = await startPaymentAttempt({
    gateway: await getActiveGateway(),
    siteUrl: await getSiteUrl(),
    orderId: order.id,
    orderNo: order.orderNo,
    amountCents: order.totalCents,
    subject: items.map((i) => i.productName).join(" + "),
  });
  if (outcome.kind === "created") {
    return { ok: true, message: "请继续付款", data: { paymentUrl: outcome.payment.paymentUrl } };
  }
  if (outcome.kind === "inactive") return { ok: false, message: outcome.message };
  if (outcome.kind === "rejected") {
    await closeOrderInternal(order.id, order.orderNo, outcome.message);
    return { ok: false, message: `创建支付失败：${outcome.message}` };
  }
  await markReconciling(order.id, outcome.message);
  return { ok: false, message: "收银台响应超时，订单已保留待核实，请勿重复付款" };
}

/* ================= 管理员操作 ================= */

export async function adminCloseOrder(
  orderNo: string,
  actor: string
): Promise<{ ok: boolean; message: string }> {
  const result = await db.transaction(async (tx) => {
    const order = await lockOrderByNo(tx, orderNo);
    if (!order) return { ok: false as const, message: "订单不存在", ref: null };
    if (order.status === "reconciling") {
      return { ok: false as const, message: "待核实订单请先在网关后台核对到账情况，再执行操作", ref: null };
    }
    if (order.status !== "pending") {
      return { ok: false as const, message: "订单当前状态不可关闭", ref: null };
    }
    const ref = await closePendingInTx(tx, order);
    await tx.insert(auditLogs).values({ actor, action: "order.close", detail: orderNo });
    return { ok: true as const, message: "订单已关闭，卡密已退回库存", ref };
  });
  if (result.ref) cancelAtGateway(result.ref.channel, result.ref.providerRef, "admin");
  return { ok: result.ok, message: result.message };
}

/** 确认网关未建单（reconciling 订单的安全出口之一） */
export async function resolveReconcilingAsNotCreated(
  orderNo: string,
  actor: string
): Promise<{ ok: boolean; message: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1).for("update");
    const order = rows[0];
    if (!order) return { ok: false, message: "订单不存在" };
    if (order.status !== "reconciling") return { ok: false, message: "当前订单状态无需核实" };
    assertTransition(order.status, "closed");
    await tx.update(orders).set({ status: "closed", updatedAt: new Date() }).where(eq(orders.id, order.id));
    await releaseStock(tx, order.id);
    await tx.insert(auditLogs).values({ actor, action: "order.reconcile_close", detail: orderNo });
    return { ok: true, message: "已确认网关无此交易，订单已关闭并退回卡密" };
  });
}

/** 管理员确认 reconciling 订单实际已到账 → 推进 paid 并交付 */
export async function resolveReconcilingAsPaid(
  orderNo: string,
  actor: string
): Promise<{ ok: boolean; message: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1).for("update");
    const order = rows[0];
    if (!order) return { ok: false, message: "订单不存在" };
    if (order.status !== "reconciling") return { ok: false, message: "当前订单状态无需核实" };
    assertTransition(order.status, "paid");
    await tx
      .update(orders)
      .set({ status: "paid", paidAt: new Date(), expiresAt: null, updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    const current = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)))
      .limit(1);
    if (current[0]) {
      await tx
        .update(payments)
        .set({ status: "confirmed", confirmedAt: new Date(), updatedAt: new Date() })
        .where(eq(payments.id, current[0].id));
    }
    await tx.insert(auditLogs).values({ actor, action: "order.reconcile_paid", detail: orderNo });
    const done = await deliverOrder(tx, order.id);
    if (!done) await notifyPaidUndelivered(tx, orderNo);
    return done
      ? { ok: true, message: "已确认到账并发放卡密" }
      : { ok: true, message: "已确认到账，但可用卡密不足，请补货后点击「重试发卡」" };
  });
}

/** paid 订单重试发卡（例如补货后） */
export async function retryDelivery(orderNo: string, actor: string): Promise<{ ok: boolean; message: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1).for("update");
    const order = rows[0];
    if (!order) return { ok: false, message: "订单不存在" };
    if (order.status !== "paid") return { ok: false, message: "当前订单状态无需重试发卡" };
    const done = await deliverOrder(tx, order.id);
    await tx.insert(auditLogs).values({ actor, action: "order.retry_delivery", detail: orderNo });
    return done
      ? { ok: true, message: "卡密已发放，订单已完成" }
      : { ok: false, message: "可用卡密不足，请先导入卡密再重试" };
  });
}

/** 待发送交付邮件 */
export async function pendingDeliveryEmails(limit = 50) {
  return db
    .select({
      deliveryId: deliveries.id,
      orderNo: orders.orderNo,
      email: orders.email,
      content: deliveries.content,
      attempts: deliveries.emailAttempts,
    })
    .from(deliveries)
    .innerJoin(orders, eq(deliveries.orderId, orders.id))
    .where(
      and(
        isNotNull(orders.completedAt),
        sql`${deliveries.emailSentAt} is null`,
        sql`${deliveries.emailAttempts} < 5`
      )
    )
    .orderBy(asc(deliveries.id))
    .limit(limit);
}

export async function markDeliveryEmailSent(deliveryId: number): Promise<void> {
  await db
    .update(deliveries)
    .set({ emailSentAt: new Date(), emailError: null })
    .where(eq(deliveries.id, deliveryId));
}

export async function markDeliveryEmailFailed(deliveryId: number, error: string): Promise<void> {
  await db
    .update(deliveries)
    .set({ emailAttempts: sql`${deliveries.emailAttempts} + 1`, emailError: error.slice(0, 500) })
    .where(eq(deliveries.id, deliveryId));
}

/** 公开付款状态页只读取展示所需的订单、商品与当前付款链接。 */
export async function getOrderWithItems(orderNo: string) {
  const [row] = await db.select({
    order: { id: orders.id, orderNo: orders.orderNo, status: orders.status, totalCents: orders.totalCents, expiresAt: orders.expiresAt },
    payment: { status: payments.status, expiresAt: payments.expiresAt, paymentUrl: payments.paymentUrl, isCurrent: payments.isCurrent, channel: payments.channel, providerRef: payments.providerRef },
  }).from(orders)
    .leftJoin(payments, and(eq(payments.orderId, orders.id), eq(payments.isCurrent, true)))
    .where(eq(orders.orderNo, orderNo)).orderBy(desc(payments.id)).limit(1);
  if (!row) return null;
  const items = await db.select({
    id: orderItems.id, productName: orderItems.productName,
    quantity: orderItems.quantity, lineTotalCents: orderItems.lineTotalCents,
  }).from(orderItems).where(eq(orderItems.orderId, row.order.id)).orderBy(asc(orderItems.id));
  return { ...row, items };
}
