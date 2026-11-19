import { and, asc, desc, eq, isNotNull, lt, sql } from "drizzle-orm";
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
import { getActiveGateway, getAdapter, getGatewayByType, webhookPath } from "./payments";
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
    const quantity = Math.trunc(i.quantity);
    if (slug === "" || !(quantity > 0)) continue;
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
  if (!(await getActiveGateway())) {
    throw new OrderError("NO_PAYMENT_CHANNEL", "收款通道暂不可用，请稍后再试或联系客服");
  }
  const note = input.note?.trim().slice(0, 500) ?? "";
  // 事务外读配置：事务内不得再向连接池借连接（见 notifyLowStockCrossings）
  const { lowStockThreshold } = await getConfig();
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
        for (const item of items) {
          const rows = await tx.select().from(products).where(eq(products.slug, item.slug)).limit(1);
          const p = rows[0];
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
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  if (!created) throw new OrderError("ORDER_NO_COLLISION", "订单号生成失败");

  // 2) 网关建单（网络调用在库存事务之外）
  const outcome = await startPaymentAttempt({
    orderId: created.orderId,
    orderNo: created.orderNo,
    amountCents: created.totalCents,
    subject: created.itemRows.map((r) => r.productName).join(" + "),
  });

  if (outcome.kind === "rejected") {
    await closeOrderInternal(created.orderId, created.orderNo, outcome.message);
    throw new OrderError("PAYMENT_FAILED", `创建支付失败：${outcome.message}`);
  }
  if (outcome.kind === "unknown") {
    await markReconciling(created.orderId, outcome.message);
    return {
      orderNo: created.orderNo,
      queryPassword,
      totalCents: created.totalCents,
      status: "reconciling",
      paymentUrl: null,
      reconciling: true,
    };
  }
  return {
    orderNo: created.orderNo,
    queryPassword,
    totalCents: created.totalCents,
    status: "pending",
    paymentUrl: outcome.payment.paymentUrl,
    reconciling: false,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

async function markReconciling(orderId: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    const order = rows[0];
    if (!order || order.status !== "pending") return;
    assertTransition(order.status, "reconciling");
    await tx
      .update(orders)
      .set({ status: "reconciling", expiresAt: null, updatedAt: new Date() })
      .where(eq(orders.id, orderId));
    await notifyReconciling(tx, order.orderNo, order.totalCents, reason);
  });
}

interface PendingItemRow {
  productId: number;
  productName: string;
  quantity: number;
}

type AttemptOutcome =
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
  orderId: string;
  orderNo: string;
  amountCents: number;
  subject: string;
}): Promise<AttemptOutcome> {
  const gateway = await getActiveGateway();
  if (!gateway) {
    // 校验与调用之间网关被停用：按「明确拒绝」处理，让上层关单并退回卡密
    return { kind: "rejected", message: "支付网关未配置或已停用" };
  }
  const adapter = getAdapter(gateway.type);
  const base = await getSiteUrl();

  // 先落一条 pending 支付记录（作废旧尝试），让「unknown」也有归属。
  // 订单行锁 + 状态复核：并发的「重新支付」/回调/关单不会与本次尝试交错。
  const attempt = await db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, input.orderId)).limit(1).for("update");
    if (rows[0]?.status !== "pending") return null;
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
    return { paymentId: inserted[0]!.id, superseded };
  });
  if (!attempt) return { kind: "rejected", message: "订单已不在待支付状态" };
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
      await db.transaction(async (tx) => {
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
          .where(eq(payments.id, attempt.paymentId))
          .returning({ isCurrent: payments.isCurrent });
        if (rows[0]?.status === "pending" && updated[0]?.isCurrent) {
          await tx
            .update(orders)
            .set({ expiresAt: created.expiresAt, updatedAt: new Date() })
            .where(eq(orders.id, input.orderId));
        }
      });
    } catch (err) {
      console.error("[payment] 网关已建单但回填失败，转对账", err);
      return { kind: "unknown", message: "网关已建单但本地记录失败" };
    }
    return { kind: "created", payment: { paymentUrl: created.paymentUrl, expiresAt: created.expiresAt } };
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
async function closeOrderInternal(orderId: string, orderNo: string, reason: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    const order = rows[0];
    if (!order || order.status !== "pending") return;
    await closePendingInTx(tx, order);
    await tx.insert(notifyLogs).values({
      channel: "internal",
      orderNo,
      payloadHash: sha256Hex(`rejected:${orderNo}:${reason}:${Date.now()}`),
      payload: `网关建单被拒绝，订单已关闭并释放卡密：${reason}`.slice(0, 2000),
      handled: true,
    });
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
    return { respond: "success", handled: false, message: verification.error ?? "验签失败" };
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
    await markHandled(true);
    return { respond: "success", handled: false, message: "订单不存在" };
  }

  // 定位支付记录：优先 (channel, providerRef)
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.channel, channel), eq(payments.providerRef, payload.providerRef)))
    .limit(1);
  let payment = paymentRows[0];

  // 当前尝试缺 providerRef = 建单响应丢失；验签通过的回调可以认领它
  if (!payment && (order.status === "reconciling" || order.status === "pending")) {
    const currentRows = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)))
      .limit(1);
    const current = currentRows[0];
    if (current && current.providerRef === null) {
      const claimed = await tx
        .update(payments)
        .set({ providerRef: payload.providerRef, updatedAt: new Date() })
        .where(and(eq(payments.id, current.id), sql`provider_ref is null`))
        .returning();
      payment = claimed[0];
    }
  }

  if (!payment || payment.orderId !== order.id) {
    await markHandled(false);
    return { respond: "success", handled: false, message: "交易不属于当前订单" };
  }

  if (payment.status === "confirmed") {
    await markHandled(true);
    return { respond: "success", handled: true, message: "该交易已确认（幂等）" };
  }

  if (payload.amount == null) {
    await markHandled(false);
    return { respond: "success", handled: false, message: "回调缺少金额字段" };
  }
  let amountMinor: number;
  try {
    amountMinor = toMinorUnits(payload.amount);
  } catch {
    await markHandled(false);
    return { respond: "success", handled: false, message: "回调金额非法" };
  }
  if (amountMinor !== order.totalCents) {
    await markHandled(false);
    return { respond: "success", handled: false, message: `金额不匹配: ${String(payload.amount)}` };
  }
  if (
    payment.expectedAmount &&
    payload.actualAmount &&
    normalizeAmount(payload.actualAmount) !== normalizeAmount(payment.expectedAmount)
  ) {
    await markHandled(false);
    return { respond: "success", handled: false, message: "actual_amount 与快照不匹配" };
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
    const candidates = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.status, "pending"), isNotNull(orders.expiresAt), lt(orders.expiresAt, new Date())))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const order of candidates) {
      const ref = await closePendingInTx(tx, order);
      if (ref) cancels.push(ref);
    }
    return candidates.map((o) => o.orderNo);
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

/** 待支付订单重新发起支付（旧尝试作废并通知网关撤销） */
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
    orderId: order.id,
    orderNo: order.orderNo,
    amountCents: order.totalCents,
    subject: items.map((i) => i.productName).join(" + "),
  });
  if (outcome.kind === "created") {
    return { ok: true, message: "已生成新的支付链接", data: { paymentUrl: outcome.payment.paymentUrl } };
  }
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

/** 按订单号取订单与明细（后台与查询页共用） */
export async function getOrderWithItems(orderNo: string) {
  const rows = await db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const deliveryRows = await db.select().from(deliveries).where(eq(deliveries.orderId, order.id)).limit(1);
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(desc(payments.id))
    .limit(1);
  return { order, items, delivery: deliveryRows[0] ?? null, payment: paymentRows[0] ?? null };
}
