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
import { generateQueryPassword, hashQueryPassword } from "@/lib/query-password";
import { sha256Hex } from "@/lib/epusdt";
import { toMinorUnits } from "@/lib/money";
import {
  releaseStock,
  reserveStock,
  sellReservedCards,
} from "./catalog";
import { getAdapter, getChannelById, getChannelByKey, listEnabledChannels } from "./payments";
import type { ChannelRuntime, NotifyPayload } from "./payments/types";
import { getSiteUrl } from "./settings";

/**
 * 订单服务：创建、支付回调确认、状态机、原子发卡、过期清扫。
 *
 * 安全不变量：
 * - 金额永远由服务端按商品价格计算，买家输入只含 slug + 数量
 * - 履约只信**验签通过的服务端回调**；前端回跳仅用于展示
 * - 卡密分配在数据库事务内完成（FOR UPDATE SKIP LOCKED），一卡不会两卖
 * - 回调幂等：payments(channel_id, provider_ref) 唯一 + notify_logs(payload_hash) 去重
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

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/* ================= 下单 ================= */

export interface CheckoutItemInput {
  slug: string;
  quantity: number;
}

export interface CreateOrderInput {
  email: string;
  items: CheckoutItemInput[];
  note?: string;
  channelKey?: string;
}

export interface CreateOrderResult {
  orderNo: string;
  queryPassword: string;
  totalCents: number;
  currency: string;
  status: string;
  paymentUrl: string | null;
  reconciling: boolean;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function createOrder(input: CreateOrderInput): Promise<CreateOrderResult> {
  const email = input.email.trim().toLowerCase();
  if (!EMAIL_RE.test(email) || email.length > 200) {
    throw new OrderError("INVALID_INPUT", "请输入有效的联系邮箱");
  }
  const items = input.items
    .map((i) => ({ slug: i.slug.trim(), quantity: Math.trunc(i.quantity) }))
    .filter((i) => i.slug !== "" && i.quantity > 0);
  if (items.length === 0 || items.length > 20) {
    throw new OrderError("INVALID_INPUT", "购物车为空或商品种类过多");
  }
  if (items.some((i) => i.quantity < 1 || i.quantity > 99)) {
    throw new OrderError("INVALID_INPUT", "单件商品数量需在 1-99 之间");
  }
  const note = input.note?.trim().slice(0, 500) ?? "";
  const queryPassword = generateQueryPassword();
  const passwordHash = await hashQueryPassword(queryPassword);

  // 站点币种（全站统一；事务外读取即可——改配置不会影响进行中的下单）
  const { getSiteCurrency } = await import("./settings");
  const currency = await getSiteCurrency();

  // 1) 事务：加载商品快照 → 建订单 + 明细 → 锁库存（单一事务；订单号冲突整体重试）
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
            currency,
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
        await reserveStock(
          tx,
          order.id,
          itemRows.map((r) => ({ productId: r.productId, quantity: r.quantity }))
        );
        return { orderId: order.id, orderNo: order.orderNo, totalCents: subtotal, itemRows };
      });
      break;
    } catch (err) {
      if (isUniqueViolation(err) && attempt < 2) continue;
      throw err;
    }
  }
  if (!created) throw new OrderError("ORDER_NO_COLLISION", "订单号生成失败");

  // 2) 渠道建单（网络调用在库存事务之外）
  const outcome = await startPaymentAttempt({
    orderId: created.orderId,
    orderNo: created.orderNo,
    amountCents: created.totalCents,
    currency,
    subject: created.itemRows.map((r) => r.productName).join(" + "),
    requestedChannelKey: input.channelKey,
  });

  if (outcome.kind === "rejected") {
    await closeOrderInternal(created.orderId, created.orderNo, created.itemRows, "rejected");
    throw new OrderError("PAYMENT_FAILED", `支付渠道创建失败: ${outcome.message}`);
  }
  if (outcome.kind === "unknown") {
    await db.transaction(async (tx) => {
      const rows = await tx.select().from(orders).where(eq(orders.id, created.orderId)).limit(1).for("update");
      const order = rows[0];
      if (!order || order.status !== "pending") return;
      assertTransition(order.status, "reconciling");
      await tx
        .update(orders)
        .set({ status: "reconciling", expiresAt: null, updatedAt: new Date() })
        .where(eq(orders.id, created.orderId));
    });
    return {
      orderNo: created.orderNo,
      queryPassword,
      totalCents: created.totalCents,
      currency,
      status: "reconciling",
      paymentUrl: null,
      reconciling: true,
    };
  }
  return {
    orderNo: created.orderNo,
    queryPassword,
    totalCents: created.totalCents,
    currency,
    status: "pending",
    paymentUrl: outcome.payment.paymentUrl,
    reconciling: false,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "23505";
}

interface PendingItemRow {
  productId: number;
  productName: string;
  quantity: number;
}

/** 为订单发起一次支付尝试（新建订单或重新支付共用） */
async function startPaymentAttempt(input: {
  orderId: string;
  orderNo: string;
  amountCents: number;
  currency: string;
  subject: string;
  requestedChannelKey?: string;
}): Promise<
  | { kind: "created"; payment: { paymentUrl: string | null; expiresAt: Date | null } }
  | { kind: "rejected"; message: string }
  | { kind: "unknown"; message: string }
> {
  const channel = input.requestedChannelKey
    ? ((await getChannelByKey(input.requestedChannelKey)) ?? (await requireDefaultChannel()))
    : await requireDefaultChannel();
  if (!channel) throw new OrderError("NO_PAYMENT_CHANNEL", "未启用任何支付渠道，请到后台设置");
  const adapter = getAdapter(channel.type);
  const base = await getSiteUrl();
  const notifyUrl = `${base}/api/webhooks/pay/${channel.key}`;
  const redirectUrl = `${base}/pay/${input.orderNo}`;

  // 先落一条 pending 支付记录（作废旧尝试），让「unknown」也有归属
  await db.transaction(async (tx) => {
    await tx
      .update(payments)
      .set({ isCurrent: false, status: "expired", updatedAt: new Date() })
      .where(and(eq(payments.orderId, input.orderId), eq(payments.isCurrent, true)));
    await tx.insert(payments).values({
      orderId: input.orderId,
      channelId: channel.id,
      status: "pending",
      isCurrent: true,
      amountCents: input.amountCents,
      currency: input.currency,
    });
  });

  const outcome = await adapter.createPayment(channel, {
    orderNo: input.orderNo,
    amountMinor: input.amountCents,
    currency: input.currency,
    subject: input.subject,
    notifyUrl,
    redirectUrl,
  });

  if (outcome.kind === "created") {
    await db
      .update(payments)
      .set({
        providerRef: outcome.payment.providerRef,
        paymentUrl: outcome.payment.paymentUrl,
        expectedAmount: outcome.payment.expectedAmount,
        expiresAt: outcome.payment.expiresAt,
        raw: (outcome.payment.raw ?? null) as never,
        updatedAt: new Date(),
      })
      .where(and(eq(payments.orderId, input.orderId), eq(payments.isCurrent, true)));
    // 订单回填有效期（事务内二次校验状态，避免与并发回调竞争）
    await db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(orders)
        .where(eq(orders.id, input.orderId))
        .limit(1)
        .for("update");
      const order = rows[0];
      if (!order || (order.status !== "pending" && order.status !== "reconciling")) return;
      if (order.status === "pending") {
        await tx
          .update(orders)
          .set({ expiresAt: outcome.payment.expiresAt, updatedAt: new Date() })
          .where(eq(orders.id, input.orderId));
      }
    });
    return {
      kind: "created",
      payment: { paymentUrl: outcome.payment.paymentUrl, expiresAt: outcome.payment.expiresAt },
    };
  }

  await db
    .update(payments)
    .set({ status: "failed", updatedAt: new Date() })
    .where(and(eq(payments.orderId, input.orderId), eq(payments.isCurrent, true)));
  return outcome;
}

async function requireDefaultChannel(): Promise<ChannelRuntime> {
  const channels = await listEnabledChannels();
  if (channels.length === 0) throw new OrderError("NO_PAYMENT_CHANNEL", "未启用任何支付渠道");
  return channels[0]!;
}

/** 明确拒绝：补偿关单并释放库存 */
async function closeOrderInternal(
  orderId: string,
  orderNo: string,
  items: PendingItemRow[],
  reason: string
): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
    const order = rows[0];
    if (!order || order.status !== "pending") return;
    assertTransition(order.status, "closed");
    await tx
      .update(orders)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await releaseStock(
      tx,
      order.id,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
    );
    await tx.insert(notifyLogs).values({
      channelKey: "internal",
      orderNo,
      payloadHash: sha256Hex(`rejected:${orderNo}:${reason}:${Date.now()}`),
      payload: `支付创建被拒绝，订单已关闭并释放库存：${reason}`.slice(0, 2000),
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

/** 验签失败聚合计数（内存，不落库——防未认证请求写满磁盘） */
const rejectedNotify = new Map<string, number>();
export function rejectedNotifyStats(): Record<string, number> {
  return Object.fromEntries(rejectedNotify);
}

export async function handlePaymentWebhook(channelKey: string, rawBody: string): Promise<WebhookResult> {
  const channel = await getChannelByKey(channelKey);
  if (!channel) return { respond: "fail", handled: false, message: `未启用渠道: ${channelKey}` };
  const adapter = getAdapter(channel.type);
  const verification = adapter.verifyNotify(channel, rawBody);

  if (!verification.ok || !verification.payload) {
    const hour = Math.floor(Date.now() / 3600_000);
    const key = `${channelKey}|${hour}`;
    rejectedNotify.set(key, (rejectedNotify.get(key) ?? 0) + 1);
    return { respond: "success", handled: false, message: verification.error ?? "验签失败" };
  }
  const payload = verification.payload;
  const payloadHash = sha256Hex(rawBody);

  try {
    await db.insert(notifyLogs).values({
      channelKey,
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
  channel: ChannelRuntime,
  payload: NotifyPayload,
  payloadHash: string
): Promise<WebhookResult> {
  const markHandled = async (handled: boolean) => {
    await tx.update(notifyLogs).set({ handled }).where(eq(notifyLogs.payloadHash, payloadHash));
  };

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

  // 定位支付记录：优先 (channel, providerRef)；reconciling 订单允许按当前尝试认领
  const paymentRows = await tx
    .select()
    .from(payments)
    .where(and(eq(payments.channelId, channel.id), eq(payments.providerRef, payload.providerRef)))
    .limit(1);
  let payment = paymentRows[0];

  if (!payment && order.status === "reconciling") {
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

  if (payload.status === 1) {
    await markHandled(true);
    return { respond: "success", handled: true, message: "等待支付通知" };
  }

  // status=3 过期：仅当属于当前尝试且订单仍 pending 时关单
  if (payload.status === 3) {
    if (order.status !== "pending" || !payment.isCurrent) {
      await markHandled(true);
      return { respond: "success", handled: true, message: "过期通知，订单状态不变" };
    }
    assertTransition(order.status, "closed");
    await tx
      .update(orders)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await tx
      .update(payments)
      .set({ status: "expired", updatedAt: new Date() })
      .where(eq(payments.id, payment.id));
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await releaseStock(
      tx,
      order.id,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
    );
    await markHandled(true);
    return { respond: "success", handled: true, message: "订单已超时关闭" };
  }

  // ===== status=2 支付成功 =====

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
    amountMinor = toMinorUnits(String(payload.amount), order.currency);
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

  const deliveryDone = await deliverAutoItems(tx, order.id);
  await markHandled(true);
  return deliveryDone
    ? { respond: "success", handled: true, message: "自动发货完成" }
    : { respond: "success", handled: true, message: "已确认支付，等待交付" };
}

function normalizeAmount(v: string): string {
  const n = Number(v);
  return Number.isFinite(n) ? String(n) : v.trim();
}

/**
 * 自动发卡：reserved → sold，写入交付记录（deliveries.order_id 唯一 = 数据库级幂等）。
 * 全部条目为 auto 且卡密齐备 → completed；否则保持 paid（人工商品/防御性缺卡）。
 */
async function deliverAutoItems(tx: Tx, orderId: string): Promise<boolean> {
  const orderRows = await tx.select().from(orders).where(eq(orders.id, orderId)).limit(1).for("update");
  const order = orderRows[0];
  if (!order) return false;
  if (order.status === "completed") return true;
  if (order.status !== "paid") return false;

  const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, orderId));
  const itemProducts: Array<{ item: (typeof items)[number]; product: typeof products.$inferSelect }> = [];
  for (const item of items) {
    if (item.productId === null) return false;
    const rows = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
    const p = rows[0];
    if (!p) return false;
    itemProducts.push({ item, product: p });
  }

  const existing = await tx
    .select()
    .from(deliveries)
    .where(eq(deliveries.orderId, orderId))
    .limit(1);

  const sold = await sellReservedCards(tx, orderId);
  const expectedCount = itemProducts
    .filter((r) => r.product.deliveryType === "auto")
    .reduce((acc, r) => acc + r.item.quantity, 0);
  if (sold.length < expectedCount) return false;

  const autoContent = buildAutoContent(itemProducts, sold);
  const manualPending = itemProducts.some((r) => r.product.deliveryType === "manual");

  if (existing[0]) {
    const merged = [existing[0].content, autoContent].filter(Boolean).join("\n\n");
    await tx.update(deliveries).set({ content: merged }).where(eq(deliveries.id, existing[0].id));
  } else {
    await tx.insert(deliveries).values({
      orderId,
      content: autoContent,
      cardIds: sold.map((c) => c.id),
    });
  }

  if (manualPending) return false;
  assertTransition(order.status, "completed");
  await tx
    .update(orders)
    .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(orders.id, orderId));
  return true;
}

function buildAutoContent(
  itemProducts: Array<{ item: { productName: string }; product: typeof products.$inferSelect }>,
  sold: Array<{ id: number; content: string; productId: number | null }>
): string {
  const byProduct = new Map<number, string[]>();
  for (const c of sold) {
    if (c.productId === null) continue;
    const list = byProduct.get(c.productId) ?? [];
    list.push(c.content);
    byProduct.set(c.productId, list);
  }
  const sections: string[] = [];
  for (const { item, product } of itemProducts) {
    if (product.deliveryType !== "auto") continue;
    const contents = byProduct.get(product.id) ?? [];
    sections.push(`【${item.productName}】\n${contents.join("\n")}`);
  }
  return sections.filter(Boolean).join("\n\n");
}

/* ================= 过期清扫 ================= */

export interface SweepResult {
  closedOrders: string[];
}

/** 关闭过期 pending 订单并释放库存；同步作废过期支付记录 */
export async function sweepExpired(limit = 200): Promise<SweepResult> {
  const cancels: Array<{ channel: ChannelRuntime; providerRef: string }> = [];
  const closed = await db.transaction(async (tx) => {
    const now = new Date();
    const candidates = await tx
      .select()
      .from(orders)
      .where(and(eq(orders.status, "pending"), isNotNull(orders.expiresAt), lt(orders.expiresAt, now)))
      .limit(limit)
      .for("update", { skipLocked: true });
    const closedNos: string[] = [];
    for (const order of candidates) {
      assertTransition(order.status, "closed");
      await tx
        .update(orders)
        .set({ status: "closed", updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      const current = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)))
        .limit(1);
      if (current[0]) {
        await tx
          .update(payments)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(payments.id, current[0].id));
        if (current[0].providerRef) {
          const rt = await getChannelById(current[0].channelId);
          if (rt) cancels.push({ channel: rt, providerRef: current[0].providerRef });
        }
      }
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      await releaseStock(
        tx,
        order.id,
        items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
      );
      closedNos.push(order.orderNo);
    }
    return closedNos;
  });
  for (const c of cancels) {
    void getAdapter(c.channel.type)
      .cancelPayment?.(c.channel, c.providerRef)
      .then((r) => console.log(`[sweep-cancel] ${c.channel.key} ${c.providerRef} ok=${r.ok} ${r.message}`))
      .catch((err) => console.warn("[sweep-cancel] failed", err));
  }
  return { closedOrders: closed };
}

/* ================= 买家操作 ================= */

/** 买家取消 pending 订单（订单号 + 邮箱双因子）；同步通知网关撤销 */
export async function cancelPendingOrder(
  orderNo: string,
  email: string
): Promise<{ ok: boolean; message: string }> {
  const no = orderNo.trim();
  const mail = email.trim().toLowerCase();
  if (!no || !mail) return { ok: false, message: "请提供订单号与下单邮箱" };
  const cancelRef: { channel: ChannelRuntime; providerRef: string } | null = await db.transaction(
    async (tx) => {
      const rows = await tx.select().from(orders).where(eq(orders.orderNo, no)).limit(1).for("update");
      const order = rows[0];
      if (!order) return null;
      if (order.email.trim().toLowerCase() !== mail) return null;
      if (order.status !== "pending") return null;
      assertTransition(order.status, "closed");
      await tx
        .update(orders)
        .set({ status: "closed", updatedAt: new Date() })
        .where(eq(orders.id, order.id));
      const current = await tx
        .select()
        .from(payments)
        .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)))
        .limit(1);
      if (current[0]) {
        await tx
          .update(payments)
          .set({ status: "expired", updatedAt: new Date() })
          .where(eq(payments.id, current[0].id));
      }
      const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
      await releaseStock(
        tx,
        order.id,
        items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
      );
      if (current[0]?.providerRef) {
        const rt = await getChannelById(current[0].channelId);
        if (rt) return { channel: rt, providerRef: current[0].providerRef };
      }
      return null;
    }
  );
  if (!cancelRef) return { ok: false, message: "订单不存在、邮箱不匹配或状态不可取消" };
  void getAdapter(cancelRef.channel.type)
    .cancelPayment?.(cancelRef.channel, cancelRef.providerRef)
    .then((r) => console.log(`[buyer-cancel] ${cancelRef.providerRef} ok=${r.ok} ${r.message}`))
    .catch(() => undefined);
  return { ok: true, message: "订单已取消" };
}

/** 待支付订单重新发起支付（旧尝试作废） */
export async function resumePayment(
  orderNo: string,
  email: string
): Promise<{ ok: boolean; message: string; paymentUrl?: string | null }> {
  const mail = email.trim().toLowerCase();
  const rows = await db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
  const order = rows[0];
  if (!order || order.email !== mail) return { ok: false, message: "订单不存在或邮箱不匹配" };
  if (order.status !== "pending") return { ok: false, message: "订单不在待支付状态" };
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  if (items.length === 0) return { ok: false, message: "订单缺少商品明细" };
  const outcome = await startPaymentAttempt({
    orderId: order.id,
    orderNo: order.orderNo,
    amountCents: order.totalCents,
    currency: order.currency,
    subject: items.map((i) => i.productName).join(" + "),
  });
  if (outcome.kind === "created") {
    return { ok: true, message: "已创建新的支付", paymentUrl: outcome.payment.paymentUrl };
  }
  if (outcome.kind === "rejected") {
    await closeOrderInternal(
      order.id,
      order.orderNo,
      items.map((i) => ({ productId: i.productId ?? 0, productName: i.productName, quantity: i.quantity })),
      "rejected"
    );
    return { ok: false, message: `支付渠道创建失败: ${outcome.message}` };
  }
  await db.transaction(async (tx) => {
    const fresh = await tx.select().from(orders).where(eq(orders.id, order.id)).limit(1).for("update");
    if (fresh[0]?.status === "pending") {
      assertTransition("pending", "reconciling");
      await tx
        .update(orders)
        .set({ status: "reconciling", expiresAt: null, updatedAt: new Date() })
        .where(eq(orders.id, order.id));
    }
  });
  return { ok: false, message: "支付渠道响应超时，订单已保留待对账" };
}

/* ================= 管理员操作 ================= */

export async function adminCloseOrder(
  orderNo: string,
  actor: string
): Promise<{ ok: boolean; message: string }> {
  const result = await db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1).for("update");
    const order = rows[0];
    if (!order) return { ok: false as const, message: "订单不存在", ref: null };
    if (order.status === "reconciling") {
      return { ok: false as const, message: "待对账订单请先在网关后台核对，再执行此操作", ref: null };
    }
    if (order.status !== "pending") {
      return { ok: false as const, message: `订单状态 ${order.status} 不能关闭`, ref: null };
    }
    assertTransition(order.status, "closed");
    await tx
      .update(orders)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    const current = await tx
      .select()
      .from(payments)
      .where(and(eq(payments.orderId, order.id), eq(payments.isCurrent, true)))
      .limit(1);
    if (current[0]) {
      await tx
        .update(payments)
        .set({ status: "expired", updatedAt: new Date() })
        .where(eq(payments.id, current[0].id));
    }
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await releaseStock(
      tx,
      order.id,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
    );
    await tx.insert(auditLogs).values({ actor, action: "order.close", detail: orderNo });
    const ref = current[0]?.providerRef
      ? {
          channel: await getChannelById(current[0].channelId),
          providerRef: current[0].providerRef,
        }
      : null;
    return { ok: true as const, message: "订单已关闭", ref };
  });
  if (result.ok && result.ref?.channel) {
    void getAdapter(result.ref.channel.type)
      .cancelPayment?.(result.ref.channel, result.ref.providerRef)
      .catch(() => undefined);
  }
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
    if (order.status !== "reconciling") return { ok: false, message: `订单状态 ${order.status} 无需此操作` };
    assertTransition(order.status, "closed");
    await tx
      .update(orders)
      .set({ status: "closed", updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    const items = await tx.select().from(orderItems).where(eq(orderItems.orderId, order.id));
    await releaseStock(
      tx,
      order.id,
      items.map((i) => ({ productId: i.productId, quantity: i.quantity }))
    );
    await tx.insert(auditLogs).values({ actor, action: "order.reconcile_close", detail: orderNo });
    return { ok: true, message: "已确认网关未建单，订单关闭并释放库存" };
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
    if (order.status !== "reconciling") return { ok: false, message: `订单状态 ${order.status} 无需此操作` };
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
    const done = await deliverAutoItems(tx, order.id);
    return done
      ? { ok: true, message: "已确认到账并完成交付" }
      : { ok: true, message: "已确认到账，等待交付" };
  });
}

/** paid 订单重试自动交付 */
export async function retryDelivery(orderNo: string, actor: string): Promise<{ ok: boolean; message: string }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1).for("update");
    const order = rows[0];
    if (!order) return { ok: false, message: "订单不存在" };
    if (order.status !== "paid") return { ok: false, message: `订单状态 ${order.status} 无需重试交付` };
    const done = await deliverAutoItems(tx, order.id);
    await tx.insert(auditLogs).values({ actor, action: "order.retry_delivery", detail: orderNo });
    return done
      ? { ok: true, message: "交付完成" }
      : { ok: false, message: "仍含未交付的人工商品或卡密不足" };
  });
}

/** 人工交付：paid 订单录入内容 → completed */
export async function manualDeliver(
  orderNo: string,
  content: string,
  actor: string
): Promise<{ ok: boolean; message: string }> {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, message: "交付内容不能为空" };
  if (trimmed.length > 20_000) return { ok: false, message: "交付内容过长" };
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1).for("update");
    const order = rows[0];
    if (!order) return { ok: false, message: "订单不存在" };
    if (order.status !== "paid") return { ok: false, message: `订单状态 ${order.status} 不能人工交付` };
    const existing = await tx
      .select()
      .from(deliveries)
      .where(eq(deliveries.orderId, order.id))
      .limit(1);
    if (existing[0]) {
      await tx
        .update(deliveries)
        .set({ content: existing[0].content ? `${existing[0].content}\n\n${trimmed}` : trimmed })
        .where(eq(deliveries.id, existing[0].id));
    } else {
      await tx.insert(deliveries).values({ orderId: order.id, content: trimmed, cardIds: [] });
    }
    assertTransition(order.status, "completed");
    await tx
      .update(orders)
      .set({ status: "completed", completedAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, order.id));
    await tx.insert(auditLogs).values({ actor, action: "order.manual_deliver", detail: orderNo });
    return { ok: true, message: "人工交付完成" };
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

/** 后台最近订单 */
export async function listRecentOrders(limit = 50) {
  return db.select().from(orders).orderBy(desc(orders.createdAt)).limit(limit);
}

/** 按订单号取订单与明细（后台与查询页共用） */
export async function getOrderWithItems(orderNo: string) {
  const rows = await db.select().from(orders).where(eq(orders.orderNo, orderNo)).limit(1);
  const order = rows[0];
  if (!order) return null;
  const items = await db.select().from(orderItems).where(eq(orderItems.orderId, order.id));
  const deliveryRows = await db
    .select()
    .from(deliveries)
    .where(eq(deliveries.orderId, order.id))
    .limit(1);
  const paymentRows = await db
    .select()
    .from(payments)
    .where(eq(payments.orderId, order.id))
    .orderBy(desc(payments.id))
    .limit(1);
  return { order, items, delivery: deliveryRows[0] ?? null, payment: paymentRows[0] ?? null };
}
