import { and, eq, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { notifyLogs, orders, paymentAnomalies, paymentAttempts, products } from "@/db/schema";
import type { Order, OrderStatus } from "@/db/schema";
import { normalizeAmountString, toMinorUnits } from "@/lib/money";
import { sha256Hex } from "@/lib/signature";
import { getProvider } from "@/server/payment";
import { autoDelivery, getDeliveryStrategy } from "@/server/delivery";
import { getOrderDeliveryType, releaseOrderStock } from "@/server/delivery/release-stock";
import { createAttempt, getCurrentAttempt, isCurrentTrade } from "@/server/payment/attempts";
import type { MailKind } from "@/server/mail";
import { assertTransition } from "./state-machine";

/**
 * 验签失败的回调计数（内存聚合，**不落库**）。
 *
 * 回调接口公网可访问，若逐条持久化失败报文，未认证请求就能持续写满磁盘。
 * 这里仅做按渠道/按小时的聚合计数，保留攻击可见性，写入成本恒定。
 */
const rejectedNotify = new Map<string, number>();
let rejectedNotifyWindow = 0;
const REJECTED_NOTIFY_WINDOW_MS = 3600_000;
const REJECTED_NOTIFY_MAX_KEYS = 200;

function recordRejectedNotify(providerName: string): void {
  const hour = Math.floor(Date.now() / REJECTED_NOTIFY_WINDOW_MS);
  if (hour !== rejectedNotifyWindow) {
    rejectedNotify.clear();
    rejectedNotifyWindow = hour;
  }
  const key = `${providerName}|${hour}`;
  rejectedNotify.set(key, (rejectedNotify.get(key) ?? 0) + 1);
  if (rejectedNotify.size > REJECTED_NOTIFY_MAX_KEYS) {
    const oldest = rejectedNotify.keys().next().value;
    if (oldest !== undefined) rejectedNotify.delete(oldest);
  }
}

/** 供监控/测试读取验签失败计数 */
export function getRejectedNotifyStats(): Record<string, number> {
  return Object.fromEntries(rejectedNotify);
}

/**
 * 支付回调处理（PLAN §6-①②）：
 * - 履约只信服务器间回调；验签失败仅记录、应答 success 终止无意义重试
 * - 幂等：同 payload_hash 已处理直接跳过 + 状态机守卫 + IMMEDIATE 事务串行化
 * - 金额校验：法币金额与订单一致（整数分比较）；actual_amount 与创建快照一致
 */

export interface HandleNotifyResult {
  handled: boolean;
  /** 未处理时渠道是否应重试：false = 永久性失败（验签不过/金额不符等），应答 success 终止重试 */
  retryable: boolean;
  message: string;
  orderNo?: string;
  /** 事务提交后应发送的买家邮件（delivered=交付内容 / processing=人工待处理） */
  emailKind?: MailKind;
}

export function handlePaymentNotify(providerName: string, rawBody: string): HandleNotifyResult {
  const payloadHash = sha256Hex(rawBody);
  let verificationOk = false;
  let message = "";
  let orderNo = "";
  let status: number | null = null;

  // 渠道未启用（如生产环境的 mock）→ 直接拒绝，不落库、不抛错
  let provider;
  try {
    provider = getProvider(providerName);
  } catch {
    return { handled: false, retryable: false, message: `支付渠道未启用: ${providerName}` };
  }
  const verification = provider.verifyNotify(rawBody);
  verificationOk = verification.ok;
  message = verification.error ?? "";
  if (verification.ok && verification.payload) {
    orderNo = verification.payload.orderNo;
    status = verification.payload.status;
  }

  // 验签失败的请求**不逐条落库完整报文**：该接口公网可访问，
  // 逐条写库会让未认证请求持续消耗交易数据库的存储（DB 文件与 WAL 增长）。
  // 这里只保留**轻量聚合计数**，既足以发现攻击，又无法被用来写满磁盘。
  // 验签成功的通知才写入完整审计记录（见下方 verified 分支）。
  if (!verificationOk || !verification.payload) {
    recordRejectedNotify(providerName);
    return { handled: false, retryable: false, message: message || "回调验签失败" };
  }
  const payload = verification.payload;

  const logId = db
    .insert(notifyLogs)
    .values({ provider: providerName, orderNo, payloadHash, payload: rawBody.slice(0, 10000), status, handled: false })
    .returning({ id: notifyLogs.id })
    .get()?.id;

  // 重复通知去重 + 履约必须在同一个 IMMEDIATE 事务内完成。
  // 若把去重查询放在事务外，两个并发的相同回调会同时通过检查（都还没标记 handled），
  // 从而重复进入履约流程。虽然 processNotify 的状态机与 reserved 卡复用能兜住
  // 重复发货，但在事务内判定更严谨，也避免无谓的写事务。
  const result = db.transaction(
    (tx) => {
      const seen = tx
        .select({ id: notifyLogs.id })
        .from(notifyLogs)
        .where(and(eq(notifyLogs.payloadHash, payloadHash), eq(notifyLogs.handled, true)))
        .get();
      if (seen) {
        return {
          handled: true,
          retryable: false,
          message: "重复通知，已跳过",
        } satisfies HandleNotifyResult;
      }
      return processNotify(tx, payload);
    },
    { behavior: "immediate" }
  );
  result.orderNo = payload.orderNo;
  if (logId) markHandled(logId, result.handled);
  return result;
}

function markHandled(id: number, handled: boolean): void {
  db.update(notifyLogs).set({ handled }).where(eq(notifyLogs.id, id)).run();
}

/**
 * 登记「超时后到账」异常（必须在事务内调用）。
 *
 * 为什么不能自动发货：清扫已把卡密释放回 available，可能已被其他订单买走。
 * 直接给该订单发卡会造成一卡多卖。正确做法是留下可追溯记录，
 * 由管理员核对链上到账后决定补发（从卡池重新取卡）或退款。
 *
 * 幂等：同一 trade_id 重复回调只登记一条。
 */
function recordLatePaymentAnomaly(
  tx: DbTransaction,
  order: Order,
  payload: import("@/server/payment").NotifyPayload,
  kind: "late_payment" | "duplicate_payment" = "late_payment"
): number | string {
  if (payload.tradeId) {
    const existing = tx
      .select({ id: paymentAnomalies.id })
      .from(paymentAnomalies)
      .where(
        and(
          eq(paymentAnomalies.orderNo, order.orderNo),
          eq(paymentAnomalies.tradeId, payload.tradeId)
        )
      )
      .get();
    if (existing) return existing.id;
  }
  const row = tx
    .insert(paymentAnomalies)
    .values({
      orderNo: order.orderNo,
      provider: payload.provider,
      tradeId: payload.tradeId,
      amount: String(payload.amount ?? ""),
      currency: order.currency,
      orderStatusAtArrival: order.status,
      kind,
      status: "open",
      payload: JSON.stringify({
        amount: payload.amount,
        actualAmount: payload.actualAmount,
        blockTxnId: payload.blockTxnId,
        status: payload.status,
      }).slice(0, 2000),
    })
    .returning({ id: paymentAnomalies.id })
    .get();
  return row?.id ?? "?";
}

/** 更新指定 trade_id 的支付尝试状态（回调处理时调用，必须传 tx 以保持原子性） */
function markAttemptStatus(
  tx: DbTransaction,
  tradeId: string | null,
  status: "paid" | "expired",
  paidAt?: Date
): void {
  if (!tradeId) return;
  tx.update(paymentAttempts)
    .set({ status, paidAt: paidAt ?? null, updatedAt: new Date() })
    .where(eq(paymentAttempts.tradeId, tradeId))
    .run();
}


/**
 * 成功回调的归属与金额校验（**必须在任何状态变更或异常登记之前执行**）。
 *
 * 签名只证明报文来自渠道，**不能**证明 trade_id 与金额属于当前订单。
 * 历史缺陷：异常到账分支位于这些校验之前，导致「金额不符 / 交易号不属于本单」
 * 的已签名通知也会进入可补发的人工队列 —— 会把伪造或错配的通知
 * 变成真实的补发动作。
 */
function validateSuccessOwnership(
  tx: DbTransaction,
  order: Order,
  payload: import("@/server/payment").NotifyPayload
): { ok: true } | { ok: false; message: string } {
  // trade_id 必须存在且属于本订单（不能因缺失而跳过校验）
  if (!payload.tradeId) {
    return { ok: false, message: "回调缺少 trade_id，拒绝处理" };
  }
  const current = getCurrentAttempt(order.orderNo, tx);
  if (current) {
    if (current.provider !== payload.provider) {
      return { ok: false, message: "支付渠道与交易快照不匹配" };
    }
    if (current.tradeId !== payload.tradeId) {
      return { ok: false, message: "trade_id 非当前交易，拒绝处理" };
    }
  } else if (order.tradeId && order.tradeId !== payload.tradeId) {
    // 兼容迁移前的历史订单（尚无 attempt 记录）
    return { ok: false, message: "trade_id 与订单快照不匹配" };
  }

  // 法币金额必须与订单一致（按币种的最小单位比较，禁浮点）
  if (payload.amount == null) {
    return { ok: false, message: "回调缺少金额字段" };
  }
  let amountMinor: bigint;
  try {
    amountMinor = toMinorUnits(payload.amount, order.currency);
  } catch {
    return { ok: false, message: `回调金额非法: ${String(payload.amount)}` };
  }
  if (amountMinor !== BigInt(order.totalCents)) {
    return {
      ok: false,
      message: `金额不匹配: 回调 ${String(payload.amount)} ${order.currency}，订单 ${order.totalCents}（最小单位）`,
    };
  }

  // actual_amount 与创建交易快照一致（位数可不同的等值字符串）
  if (
    order.expectedActualAmount != null &&
    order.expectedActualAmount !== "" &&
    (payload.actualAmount == null || normalizeAmountString(payload.actualAmount) !== normalizeAmountString(order.expectedActualAmount))
  ) {
    return { ok: false, message: "actual_amount 与创建交易快照不匹配" };
  }

  return { ok: true };
}

/** 历史交易按自身快照验证，不能借用当前交易的实付金额。 */
function validateHistoricalAttempt(
  tx: DbTransaction,
  order: Order,
  payload: import("@/server/payment").NotifyPayload
): { historical: boolean; ok: boolean } {
  const attempt = payload.tradeId ? tx.select().from(paymentAttempts).where(
    and(eq(paymentAttempts.orderNo, order.orderNo), eq(paymentAttempts.tradeId, payload.tradeId))
  ).get() : undefined;
  if (!attempt || attempt.isCurrent) return { historical: false, ok: false };
  let ok = attempt.provider === payload.provider && attempt.currency === order.currency;
  try {
    ok = ok && payload.amount != null &&
      toMinorUnits(payload.amount, attempt.currency) === BigInt(attempt.amountCents);
  } catch { ok = false; }
  // 旧数据没有实付金额快照时保留兼容；有快照则必须提供并匹配。
  if (attempt.expectedActualAmount) {
    ok = ok && payload.actualAmount != null &&
      normalizeAmountString(payload.actualAmount) === normalizeAmountString(attempt.expectedActualAmount);
  }
  return { historical: true, ok };
}

function processNotify(
  tx: DbTransaction,
  payload: import("@/server/payment").NotifyPayload
): HandleNotifyResult {
  const order = tx.select().from(orders).where(eq(orders.orderNo, payload.orderNo)).get();
  if (!order) return { handled: false, retryable: false, message: "订单不存在" };

  // status=1 等待支付：仅记录
  if (payload.status === 1) {
    return { handled: true, retryable: false, message: "等待支付通知，忽略" };
  }

  // status=3 支付超时：仅当该 trade_id 是订单「当前有效尝试」时才关闭订单。
  // 关键：订单可能已重新发起支付（新 trade_id）。此时旧交易的延迟超时回调
  // 若直接关单，会误杀一张已在新地址待支付的订单（买家随后付款成功却无法履约）。
  if (payload.status === 3) {
    if (order.status !== "pending") {
      return { handled: true, retryable: false, message: `超时通知，订单状态为 ${order.status}，忽略` };
    }
    if (!isCurrentTrade(tx, order.orderNo, payload.tradeId)) {
      // 旧交易/无主交易：记录但不改变订单，同时对账留痕
      return {
        handled: false,
        retryable: false,
        message: "超时回调属于非当前交易，已忽略（保留对账记录）",
      };
    }
    assertTransition("pending", "expired");
    // 统一释放入口：幂等回补并清除占用标志
    releaseOrderStock(tx, order.orderNo);
    tx.update(orders)
      .set({ status: "expired" as OrderStatus, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .run();
    markAttemptStatus(tx, payload.tradeId, "expired");
    return { handled: true, retryable: false, message: "订单已超时关闭" };
  }

  // 所有订单状态先识别历史交易，终态也需要追踪另一笔真实到账。
  const historical = validateHistoricalAttempt(tx, order, payload);
  if (historical.historical) {
    if (!historical.ok) {
      return { handled: false, retryable: false, message: "历史交易的渠道或金额快照不匹配" };
    }
    const anomalyId = recordLatePaymentAnomaly(tx, order, payload);
    return { handled: false, retryable: false,
      message: `非当前交易的到账已登记为异常待人工核对（#${anomalyId}）` };
  }

  const ownership = validateSuccessOwnership(tx, order, payload);
  if (!ownership.ok) return { handled: false, retryable: false, message: ownership.message };
  if (order.status === "completed") {
    const current = getCurrentAttempt(order.orderNo, tx);
    // 没有 attempt 的旧订单可沿用已支付快照，但不能忽略另一笔已补发的款项。
    const otherPaid = !current && tx.select({ id: paymentAttempts.id }).from(paymentAttempts)
      .where(and(eq(paymentAttempts.orderNo, order.orderNo), eq(paymentAttempts.status, "paid"),
        sql`${paymentAttempts.tradeId} != ${payload.tradeId}`)).get();
    const otherResolved = !current && tx.select({ id: paymentAnomalies.id }).from(paymentAnomalies)
      .where(and(eq(paymentAnomalies.orderNo, order.orderNo), eq(paymentAnomalies.status, "reissued"),
        sql`${paymentAnomalies.tradeId} != ${payload.tradeId}`)).get();
    const legacyPaid = !current && order.paidAt && order.tradeId === payload.tradeId && !otherPaid && !otherResolved;
    if (current?.status === "paid" || legacyPaid) {
      return { handled: true, retryable: false, message: "订单已完成（该交易已确认到账，幂等重入）" };
    }
    // 例如旧交易 A 的异常已补发，但当前 B 尚未确认到账。
    // B 的成功通知是另一笔款项，必须独立留在人工核对队列，不能再次发货。
    const anomalyId = recordLatePaymentAnomaly(tx, order, payload, "duplicate_payment");
    markAttemptStatus(tx, payload.tradeId, "paid", new Date());
    return { handled: false, retryable: false,
      message: `已交付订单收到另一笔到账，已登记重复付款待核对（#${anomalyId}）` };
  }
  if (order.status === "expired" || order.status === "closed") {
    const anomalyId = recordLatePaymentAnomaly(tx, order, payload);
    return { handled: false, retryable: false,
      message: `超时/关闭订单收到成功回调，已登记为异常到账待处理（#${anomalyId}）` };
  }
  if (!["pending", "paid", "delivering", "reconciling"].includes(order.status)) {
    return { handled: false, retryable: false, message: `订单状态 ${order.status} 不接受支付通知` };
  }

  const product = order.productId
    ? tx.select().from(products).where(eq(products.id, order.productId)).get()
    : null;
  if (!product) return { handled: false, retryable: false, message: "订单关联商品不存在" };

  // pending / reconciling → paid
  let statusNow = order.status as OrderStatus;
  if (statusNow === "pending" || statusNow === "reconciling") {
    assertTransition(statusNow, "paid");
    tx.update(orders)
      .set({
        status: "paid" as OrderStatus,
        paidAt: new Date(),
        updatedAt: new Date(),
        // 对账恢复：此时才拿到可信的 trade_id 快照（创建响应曾丢失）
        tradeId: payload.tradeId,
        blockTxnId: payload.blockTxnId ?? order.blockTxnId,
        // 已入账，清除对账标记所需的空有效期
        expirationTime: null,
      })
      .where(eq(orders.id, order.id))
      .run();
    // reconciling 订单通常没有 attempt 记录：补建一条，保证 trade_id 可追溯
    if (statusNow === "reconciling" && !getCurrentAttempt(order.orderNo, tx)) {
      createAttempt(tx, {
        orderNo: order.orderNo,
        provider: payload.provider,
        tradeId: payload.tradeId,
        amountCents: order.totalCents,
        currency: order.currency,
        paymentUrl: order.paymentUrl ?? "",
        expectedActualAmount: order.expectedActualAmount,
        expirationTime: null,
        raw: { recoveredFrom: "reconciling", amount: payload.amount },
      });
    }
    statusNow = "paid";
  }
  // 标记本次支付尝试已到账
  markAttemptStatus(tx, payload.tradeId, "paid", new Date());

  // 以订单快照为准（商品类型可能已被后台修改，历史订单不应被追溯改变）
  if (getOrderDeliveryType(tx, order) === "auto") {
    const outcome = getDeliveryStrategy("auto").fulfill(tx, order, product);
    if (outcome.ok && outcome.content != null) {
      assertTransition(statusNow, "completed");
      tx.update(orders)
        .set({
          status: "completed" as OrderStatus,
          deliveryContent: outcome.content,
          blockTxnId: payload.blockTxnId,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .run();
      return { handled: true, retryable: false, message: "自动发货完成", emailKind: "delivered" as MailKind };
    }
    // 卡池不足等临时失败：停留 delivering，后台补卡后可重试
    if (statusNow === "paid") assertTransition("paid", "delivering");
    tx.update(orders)
      .set({ status: "delivering" as OrderStatus, blockTxnId: payload.blockTxnId, updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .run();
    return { handled: false, retryable: true, message: outcome.reason ?? "自动发货未完成，待重试" };
  }

  // manual 型：停留 paid，等待后台人工发货
  if (payload.blockTxnId) {
    tx.update(orders).set({ blockTxnId: payload.blockTxnId }).where(eq(orders.id, order.id)).run();
  }
  return { handled: true, retryable: false, message: "已确认支付，等待人工发货", emailKind: "processing" as MailKind };
}

/* ================= 管理员触发的发货操作（service 层，页面不得直连 DB） ================= */

export interface AdminOpResult {
  ok: boolean;
  message: string;
  emailKind?: MailKind;
}

/** 重试自动发货（卡池补货后）：paid/delivering → completed */
export function retryAutoDelivery(orderNo: string): AdminOpResult {
  return db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
      if (!order) return { ok: false, message: "订单不存在" };
      if (!["paid", "delivering"].includes(order.status)) {
        return { ok: false, message: `订单状态 ${order.status} 无需发货` };
      }
      const product = order.productId
        ? tx.select().from(products).where(eq(products.id, order.productId)).get()
        : null;
      if (!product) return { ok: false, message: "订单关联商品不存在" };
      // 以订单快照为准，避免商品被改为 manual 后无法重试原本的自动发货
      if (getOrderDeliveryType(tx, order) !== "auto") {
        return { ok: false, message: "人工发货商品请在后台录入交付内容" };
      }
      const outcome = getDeliveryStrategy("auto").fulfill(tx, order, product);
      if (!outcome.ok || outcome.content == null) {
        if (order.status === "paid") assertTransition("paid", "delivering");
        tx.update(orders)
          .set({ status: "delivering" as OrderStatus, updatedAt: new Date() })
          .where(eq(orders.id, order.id))
          .run();
        return { ok: false, message: outcome.reason ?? "发货失败" };
      }
      assertTransition(order.status as OrderStatus, "completed");
      tx.update(orders)
        .set({
          status: "completed" as OrderStatus,
          deliveryContent: order.deliveryContent
            ? `${order.deliveryContent}\n${outcome.content}` // 之前部分交付的内容保留
            : outcome.content,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .run();
      return { ok: true, message: "发货完成", emailKind: "delivered" as MailKind };
    },
    { behavior: "immediate" }
  );
}

/** 人工发货：录入交付内容，paid/delivering → completed */
export function manualDeliver(orderNo: string, content: string): AdminOpResult {
  const trimmed = content.trim();
  if (!trimmed) return { ok: false, message: "交付内容不能为空" };
  if (trimmed.length > 20000) return { ok: false, message: "交付内容过长" };
  return db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get() as Order | undefined;
      if (!order) return { ok: false, message: "订单不存在" };
      if (!["paid", "delivering"].includes(order.status)) {
        return { ok: false, message: `订单状态 ${order.status} 不能人工发货` };
      }
      const product = order.productId
        ? tx.select().from(products).where(eq(products.id, order.productId)).get()
        : null;
      if (!product) return { ok: false, message: "订单关联商品不存在" };

      // 若自动发货部分占过卡，改为人工交付时释放占用（交付以人工内容为准）
      autoDelivery.release(tx, order, product);

      assertTransition(order.status as OrderStatus, "completed");
      tx.update(orders)
        .set({
          status: "completed" as OrderStatus,
          deliveryContent: trimmed,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .run();
      return { ok: true, message: "人工发货完成", emailKind: "delivered" as MailKind };
    },
    { behavior: "immediate" }
  );
}

/** 关闭订单：pending/paid/delivering/expired → closed，释放占卡/回补库存 */
export function closeOrder(orderNo: string): AdminOpResult {
  return db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get() as Order | undefined;
      if (!order) return { ok: false, message: "订单不存在" };
      if (["completed", "closed"].includes(order.status)) {
        return { ok: false, message: `订单状态 ${order.status} 不能关闭` };
      }
      // reconciling（待对账）必须走专用的核对流程：它意味着「网关可能已建单」，
      // 直接关闭会释放库存，造成买家付款后无法履约。
      // 状态机虽允许 reconciling→closed，但那只应由 resolveReconcilingAsNotCreated()
      // 在人工核对网关之后触发；这里显式拒绝，避免通用关闭按钮绕过该约束。
      if (order.status === "reconciling") {
        return {
          ok: false,
          message: "该订单待对账（网关可能已建单），请先核对 bepusdt 后台再决定是否关闭",
        };
      }
      // 统一释放入口：幂等（已释放过的订单不会二次回补）
      releaseOrderStock(tx, order.orderNo);
      assertTransition(order.status as OrderStatus, "closed");
      tx.update(orders)
        .set({ status: "closed" as OrderStatus, updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .run();
      return { ok: true, message: "订单已关闭" };
    },
    { behavior: "immediate" }
  );
}

/**
 * 买家取消订单（前台自助）：
 * - 仅限 pending（未支付）订单；已支付/发货中/已完成一律拒绝，需联系客服
 * - 双因子校验：订单号 + 下单邮箱，避免凭订单号枚举取消他人订单
 * - 在 IMMEDIATE 事务内重新读取状态，避免与并发回调竞态（已支付则拒绝取消）
 */
export function cancelPendingOrder(orderNo: string, email: string): AdminOpResult {
  const no = orderNo.trim();
  const mail = email.trim().toLowerCase();
  if (!no || !mail) return { ok: false, message: "请提供订单号与下单邮箱" };

  return db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, no)).get() as
        | Order
        | undefined;
      if (!order) return { ok: false, message: "订单不存在" };
      if (order.email.trim().toLowerCase() !== mail) {
        return { ok: false, message: "订单号与邮箱不匹配" };
      }
      if (order.status !== "pending") {
        return {
          ok: false,
          message:
            order.status === "expired"
              ? "订单已超时，无需取消"
              : "订单已支付或已关闭，无法取消；如需帮助请联系客服",
        };
      }

      // 统一释放入口：幂等回补
      releaseOrderStock(tx, order.orderNo);

      assertTransition(order.status as OrderStatus, "closed");
      tx.update(orders)
        .set({
          status: "closed" as OrderStatus,
          paymentUrl: null,
          updatedAt: new Date(),
        })
        .where(eq(orders.id, order.id))
        .run();
      return { ok: true, message: "订单已取消" };
    },
    { behavior: "immediate" }
  );
}

/* ================= 待对账订单处理（人工出口） ================= */

/**
 * 确认网关**未创建**该交易 → 关闭订单并释放库存。
 *
 * 这是 reconciling 订单释放库存的**唯一**安全途径：必须由人工核对
 * bepusdt 后台后调用。仅凭本地倒计时释放是不允许的，因为创建响应丢失时
 * 网关可能已经建单，其支付地址仍然有效——贸然释放会导致买家付款后无法履约。
 */
export function resolveReconcilingAsNotCreated(orderNo: string): AdminOpResult {
  return db.transaction(
    (tx) => {
      const order = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get() as
        | Order
        | undefined;
      if (!order) return { ok: false, message: "订单不存在" };
      if (order.status !== "reconciling") {
        return { ok: false, message: `订单状态为 ${order.status}，无需此操作` };
      }
      // 统一释放入口：幂等回补
      releaseOrderStock(tx, order.orderNo);
      assertTransition("reconciling", "closed");
      tx.update(orders)
        .set({ status: "closed" as OrderStatus, updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .run();
      return { ok: true, message: "已确认网关未建单，订单关闭并释放库存" };
    },
    { behavior: "immediate" }
  );
}

/** 待对账订单数量（后台告警用） */
export function countReconciling(): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "reconciling"))
    .get();
  return row?.c ?? 0;
}
