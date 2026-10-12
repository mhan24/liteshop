import { and, eq, isNotNull, lt, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { adminLogs, notifyLogs, orders } from "@/db/schema";
import type { Order, OrderStatus } from "@/db/schema";
import { releaseOrderStock } from "@/server/delivery/release-stock";
import { assertTransition } from "./state-machine";

/**
 * 订单超时自动关闭（兜底）。
 *
 * 背景：订单过期的**主路径**是 bepusdt 主动回调 status=3（见 fulfill-order.ts）。
 * 但回调可能丢失（DNS 抖动、Caddy/容器重启、网关重试耗尽）。一旦丢失：
 * 订单永远停在 pending、已锁定的卡密（reserved）永不释放，导致**库存永久泄漏**，
 * 且买家仍能"继续支付"一个网关早已作废的交易。
 *
 * 因此这里提供一条不依赖回调的兜底路径，采用「惰性清扫」：
 * 在读取订单的必经路径上，顺便关闭该用户的超时订单（零额外依赖、无守护进程）。
 * 另有 /api/cron/expire 供外部定时器覆盖"无人访问"的情况。
 */

/** 单次清扫最多处理的订单数，避免长事务阻塞写锁 */
const SWEEP_BATCH_LIMIT = 200;

export interface ExpireSweepResult {
  /** 本次实际关闭的订单数 */
  expired: number;
  /** 被关闭的订单号 */
  orderNos: string[];
}

/**
 * 在事务内关闭单个超时订单。已在终态/未超时则返回 false。
 * 与回调路径共用同一套状态机与库存释放逻辑，保证语义一致。
 */
function expireOne(tx: DbTransaction, order: Order): boolean {
  const exp = order.expirationTime;
  // 仅处理：pending + 有有效期 + 已过期
  if (order.status !== "pending" || !exp || exp.getTime() > Date.now()) return false;

  assertTransition("pending", "expired");
  // 统一释放入口：幂等地回补库存并清除占用标志
  releaseOrderStock(tx, order.orderNo);
  tx.update(orders)
    .set({ status: "expired" as OrderStatus, updatedAt: new Date() })
    .where(eq(orders.id, order.id))
    .run();
  return true;
}

/**
 * 清扫已超时的 pending 订单（全站）。
 * 用 IMMEDIATE 事务串行化，避免与并发支付回调竞态；
 * 事务内重新读取并再次校验状态，确保「已支付」的订单不会被误关。
 */
export function sweepExpiredOrders(limit = SWEEP_BATCH_LIMIT): ExpireSweepResult {
  return db.transaction(
    (tx) => {
      const now = new Date();
      const candidates = tx
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.status, "pending"),
            isNotNull(orders.expirationTime),
            lt(orders.expirationTime, now)
          )
        )
        .limit(limit)
        .all();

      const orderNos: string[] = [];
      for (const order of candidates) {
        // expireOne 内部二次校验，防止读取与更新之间状态已变（如刚支付成功）
        if (expireOne(tx, order)) orderNos.push(order.orderNo);
      }
      return { expired: orderNos.length, orderNos };
    },
    { behavior: "immediate" }
  );
}

/**
 * 惰性清扫：仅针对给定订单号，若其已超时则就地关闭。
 * 供订单读取路径（查单/状态轮询）调用，成本恒定且仅在必要时才开写事务。
 */
export function expireOrderIfOverdue(orderNo: string): boolean {
  // 先做一次无锁预检（绝大多数调用都不需要写事务，避免无谓加锁）
  const peek = db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
  if (!peek) return false;
  if (peek.status !== "pending" || !peek.expirationTime) return false;
  if (peek.expirationTime.getTime() > Date.now()) return false;

  // 真正写入时在 IMMEDIATE 事务内**重新读取**：
  // 预检到写入之间存在窗口，并发的支付回调可能已把订单推进为 paid/completed。
  // 复用旧对象会基于过期快照判断，导致竞态。
  return db.transaction(
    (tx) => {
      const fresh = tx.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
      if (!fresh) return false;
      return expireOne(tx, fresh);
    },
    { behavior: "immediate" }
  );
}

/** 供后台/健康检查观测：当前已超时但仍为 pending 的订单数 */
export function countOverduePending(): number {
  const row = db
    .select({ c: sql<number>`count(*)` })
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending"),
        isNotNull(orders.expirationTime),
        lt(orders.expirationTime, new Date())
      )
    )
    .get();
  return row?.c ?? 0;
}

/* ================= 日志表保留策略 ================= */

/**
 * notify_logs 保留窗口（天）。
 *
 * 安全背景：回调端点是**未认证**的，且会记录每一条请求（含验签失败者），
 * 单条 payload 最多 10KB。攻击者可反复投递畸形回调把磁盘写满。
 * 这里按时间清理历史记录，把增长限制在「窗口内的请求量」。
 * 保留期内的记录仍可用于对账与重放排查。
 */
const NOTIFY_LOG_RETENTION_DAYS = 30;

/** admin_logs 保留窗口（天）：审计需要，留存更久 */
const ADMIN_LOG_RETENTION_DAYS = 180;

export interface PurgeResult {
  notifyLogsDeleted: number;
  adminLogsDeleted: number;
}

/**
 * 清理过期日志。默认由 cron 端点调用（与订单清扫同一入口）。
 * 分批删除避免长事务阻塞写锁（SQLite 单写者）。
 */
export function purgeOldLogs(): PurgeResult {
  const notifyCutoff = new Date(Date.now() - NOTIFY_LOG_RETENTION_DAYS * 86400_000);
  const adminCutoff = new Date(Date.now() - ADMIN_LOG_RETENTION_DAYS * 86400_000);

  return db.transaction(
    (tx) => {
      const n = tx
        .delete(notifyLogs)
        .where(lt(notifyLogs.createdAt, notifyCutoff))
        .run();
      const a = tx
        .delete(adminLogs)
        .where(lt(adminLogs.createdAt, adminCutoff))
        .run();
      return {
        notifyLogsDeleted: Number(n.changes ?? 0),
        adminLogsDeleted: Number(a.changes ?? 0),
      };
    },
    { behavior: "immediate" }
  );
}
