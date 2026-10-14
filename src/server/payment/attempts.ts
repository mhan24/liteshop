import { and, desc, eq } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { paymentAttempts, type PaymentAttemptStatusType } from "@/db/schema";

/**
 * 支付尝试（payment attempts）服务。
 *
 * 设计要点：一个订单可以多次发起支付（每次得到新的 trade_id）。
 * 只有「当前有效尝试（is_current）」能推动订单状态；旧尝试的回调
 * 一律不改变订单状态，但会保留记录用于对账。
 *
 * 这样解决了两类真实问题：
 * 1) 旧交易延迟的 status=3 超时回调，会把已重新发起支付的订单误关
 *    （买家随后在新地址付款成功，却无法履约）。
 * 2) 同一订单多次支付的 history 被覆盖，失去对账依据。
 */

export interface PaymentAttemptRow {
  id: number;
  orderNo: string;
  provider: string;
  tradeId: string | null;
  amountCents: number;
  currency: string;
  paymentUrl: string;
  expectedActualAmount: string | null;
  expirationTime: Date | null;
  status: PaymentAttemptStatusType;
  isCurrent: boolean;
  paidAt: Date | null;
  /** 渠道原始响应快照（JSON 字符串）；litepay 收款信息页据此展示地址/备注 */
  raw: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateAttemptInput {
  orderNo: string;
  provider: string;
  tradeId: string | null;
  amountCents: number;
  currency: string;
  paymentUrl: string;
  expectedActualAmount: string | null;
  expirationTime: Date | null;
  raw?: unknown;
}

/**
 * 记录一次新的支付尝试，并把同订单的旧尝试置为非当前。
 * 必须在调用方的事务内执行，保证「作废旧尝试 + 写入新尝试」原子完成。
 */
export function createAttempt(tx: DbTransaction, input: CreateAttemptInput): number {
  // 旧尝试失效：标记 not current；仍处于 pending 的按 expired 处理（被新尝试取代）
  tx.update(paymentAttempts)
    .set({ isCurrent: false, updatedAt: new Date() })
    .where(and(eq(paymentAttempts.orderNo, input.orderNo), eq(paymentAttempts.isCurrent, true)))
    .run();

  tx.update(paymentAttempts)
    .set({ status: "expired", updatedAt: new Date() })
    .where(
      and(
        eq(paymentAttempts.orderNo, input.orderNo),
        eq(paymentAttempts.status, "pending")
      )
    )
    .run();

  const row = tx
    .insert(paymentAttempts)
    .values({
      orderNo: input.orderNo,
      provider: input.provider,
      tradeId: input.tradeId,
      amountCents: input.amountCents,
      currency: input.currency,
      paymentUrl: input.paymentUrl,
      expectedActualAmount: input.expectedActualAmount,
      expirationTime: input.expirationTime,
      status: "pending",
      isCurrent: true,
      raw: input.raw === undefined ? null : JSON.stringify(input.raw).slice(0, 20000),
    })
    .returning({ id: paymentAttempts.id })
    .get();
  return row!.id;
}

/** 按 trade_id 定位支付尝试（回调归属判据） */
export function findAttemptByTradeId(
  tx: DbTransaction,
  tradeId: string
): PaymentAttemptRow | undefined {
  return tx
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.tradeId, tradeId))
    .get() as PaymentAttemptRow | undefined;
}

/** 订单的当前有效尝试 */
export function getCurrentAttempt(
  orderNo: string,
  tx: DbTransaction = db as unknown as DbTransaction
): PaymentAttemptRow | undefined {
  return tx
    .select()
    .from(paymentAttempts)
    .where(and(eq(paymentAttempts.orderNo, orderNo), eq(paymentAttempts.isCurrent, true)))
    .orderBy(desc(paymentAttempts.id))
    .get() as PaymentAttemptRow | undefined;
}

/** 订单的全部支付尝试（对账/后台展示） */
export function listAttempts(orderNo: string): PaymentAttemptRow[] {
  return db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderNo, orderNo))
    .orderBy(desc(paymentAttempts.id))
    .all() as PaymentAttemptRow[];
}

/** 判断某次回调是否来自订单的当前有效尝试 */
export function isCurrentTrade(tx: DbTransaction, orderNo: string, tradeId: string | null): boolean {
  if (!tradeId) return false;
  const cur = getCurrentAttempt(orderNo, tx);
  return cur?.tradeId === tradeId;
}

/** 订单最新的一条支付尝试（不论是否 current）——用于并发抢占判定 */
export function getLatestAttempt(
  orderNo: string,
  tx: DbTransaction = db as unknown as DbTransaction
): PaymentAttemptRow | undefined {
  return tx
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderNo, orderNo))
    .orderBy(desc(paymentAttempts.id))
    .get() as PaymentAttemptRow | undefined;
}
