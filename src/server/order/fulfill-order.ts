import { and, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { notifyLogs, orders, products } from "@/db/schema";
import type { Order, OrderStatus } from "@/db/schema";
import { normalizeAmountString, toCents } from "@/lib/money";
import { sha256Hex } from "@/lib/signature";
import { getProvider } from "@/server/payment";
import { autoDelivery, getDeliveryStrategy } from "@/server/delivery";
import type { MailKind } from "@/server/mail";
import { assertTransition } from "./state-machine";

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

  const provider = getProvider(providerName);
  const verification = provider.verifyNotify(rawBody);
  verificationOk = verification.ok;
  message = verification.error ?? "";
  if (verification.ok && verification.payload) {
    orderNo = verification.payload.orderNo;
    status = verification.payload.status;
  }

  const logId = db
    .insert(notifyLogs)
    .values({ provider: providerName, orderNo, payloadHash, payload: rawBody.slice(0, 10000), status, handled: false })
    .returning({ id: notifyLogs.id })
    .get()?.id;

  if (!verificationOk || !verification.payload) {
    return { handled: false, retryable: false, message: message || "回调验签失败" };
  }
  const payload = verification.payload;

  // 重复通知（同 hash 已处理过）→ 跳过（防重放/防 bepusdt 重试重复发货）
  const seen = db
    .select({ id: notifyLogs.id })
    .from(notifyLogs)
    .where(and(eq(notifyLogs.payloadHash, payloadHash), eq(notifyLogs.handled, true)))
    .get();
  if (seen) {
    if (logId) markHandled(logId, true);
    return { handled: true, retryable: false, message: "重复通知，已跳过" };
  }

  const result = db.transaction(
    (tx) => processNotify(tx, payload),
    { behavior: "immediate" }
  );
  result.orderNo = payload.orderNo;
  if (logId) markHandled(logId, result.handled);
  return result;
}

function markHandled(id: number, handled: boolean): void {
  db.update(notifyLogs).set({ handled }).where(eq(notifyLogs.id, id)).run();
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

  // status=3 支付超时：pending → expired
  if (payload.status === 3) {
    if (order.status === "pending") {
      assertTransition("pending", "expired");
      const product = order.productId
        ? tx.select().from(products).where(eq(products.id, order.productId)).get()
        : null;
      if (product) {
        // 未支付超时：回补 manual 库存等占用
        getDeliveryStrategy(product.deliveryType).release(tx, order, product);
      }
      tx.update(orders)
        .set({ status: "expired" as OrderStatus, updatedAt: new Date() })
        .where(eq(orders.id, order.id))
        .run();
      return { handled: true, retryable: false, message: "订单已超时关闭" };
    }
    return { handled: true, retryable: false, message: `超时通知，订单状态为 ${order.status}，忽略` };
  }

  // ===== status=2 支付成功 =====
  if (order.status === "completed") {
    return { handled: true, retryable: false, message: "订单已完成（幂等重入）" };
  }
  if (!["pending", "paid", "delivering"].includes(order.status)) {
    return { handled: false, retryable: false, message: `订单状态 ${order.status} 不接受支付通知` };
  }

  // trade_id 必须与创建交易快照一致（防跨订单伪造）
  if (order.tradeId && payload.tradeId && order.tradeId !== payload.tradeId) {
    return { handled: false, retryable: false, message: "trade_id 与订单快照不匹配" };
  }

  // 法币金额必须与订单一致（整数分比较，禁浮点运算）
  if (payload.amount == null) {
    return { handled: false, retryable: false, message: "回调缺少金额字段" };
  }
  let amountCents: bigint;
  try {
    amountCents = toCents(payload.amount);
  } catch {
    return { handled: false, retryable: false, message: `回调金额非法: ${String(payload.amount)}` };
  }
  if (amountCents !== BigInt(order.totalCents)) {
    return { handled: false, retryable: false, message: `金额不匹配: 回调 ${String(payload.amount)}，订单 ${order.totalCents} 分` };
  }

  // actual_amount 与创建交易快照一致（位数可不同的等值字符串）
  if (
    payload.actualAmount != null &&
    order.expectedActualAmount != null &&
    order.expectedActualAmount !== "" &&
    normalizeAmountString(payload.actualAmount) !== normalizeAmountString(order.expectedActualAmount)
  ) {
    return { handled: false, retryable: false, message: "actual_amount 与创建交易快照不匹配" };
  }

  const product = order.productId
    ? tx.select().from(products).where(eq(products.id, order.productId)).get()
    : null;
  if (!product) return { handled: false, retryable: false, message: "订单关联商品不存在" };

  // pending → paid
  let statusNow = order.status as OrderStatus;
  if (statusNow === "pending") {
    assertTransition("pending", "paid");
    tx.update(orders)
      .set({ status: "paid" as OrderStatus, paidAt: new Date(), updatedAt: new Date() })
      .where(eq(orders.id, order.id))
      .run();
    statusNow = "paid";
  }

  if (product.deliveryType === "auto") {
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
      if (product.deliveryType !== "auto") {
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
      const product = order.productId
        ? tx.select().from(products).where(eq(products.id, order.productId)).get()
        : null;
      if (product) {
        getDeliveryStrategy(product.deliveryType).release(tx, order, product);
      }
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
