import { and, asc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, notifications, products } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { revealSecret } from "@/lib/secret-box";
import type { Tx } from "./db-tx";
import { getConfig } from "./settings";

/**
 * 运营通知：需要人工关注的事件写入 notifications 发件箱（与业务同一事务），
 * cron 每分钟投递到 Telegram，失败重试至 5 次。未配置 Telegram 时只积压在库里，
 * 配好后会补发最近 24 小时内的积压（更早的直接放弃，避免一次性刷屏陈旧消息）。
 */

type Kind = (typeof notifications.$inferInsert)["kind"];
type Db = Tx | typeof db;

const MAX_ATTEMPTS = 5;
const STALE_MS = 24 * 3600_000;

async function enqueue(executor: Db, kind: Kind, text: string): Promise<void> {
  await executor.insert(notifications).values({ kind, text: text.slice(0, 3500) });
}

export function notifyReconciling(executor: Db, orderNo: string, totalCents: number, reason: string) {
  return enqueue(
    executor,
    "order_reconciling",
    `⚠️ 订单待核实\n订单 ${orderNo}（${formatMoney(totalCents)}）\n网关建单结果未知：${reason}\n请到网关后台核对后，在「订单」页确认到账或关闭。`
  );
}

export function notifyLatePayment(executor: Db, orderNo: string, providerRef: string, amount: string) {
  return enqueue(
    executor,
    "payment_late",
    `⚠️ 延迟到账\n订单 ${orderNo} 已关闭或已由其它交易完成，又收到交易 ${providerRef} 的付款（${amount} USD）。\n请人工核对后退款或补发。`
  );
}

export function notifyPaidUndelivered(executor: Db, orderNo: string) {
  return enqueue(
    executor,
    "paid_undelivered",
    `🚨 已付款但卡密不足\n订单 ${orderNo} 已确认付款，库存不够发卡。\n请导入卡密后在「订单」页点「重试发卡」。`
  );
}

/**
 * 低库存：只在可售数「跌破阈值」或「售罄」的那一次通知（对比本次锁卡前后的数量），
 * 不会每卖一单都提醒。须在锁卡的同一事务内、锁卡之后调用。
 */
export async function notifyLowStockCrossings(
  tx: Tx,
  reserved: Array<{ productId: number; quantity: number }>
): Promise<void> {
  if (reserved.length === 0) return;
  const { lowStockThreshold } = await getConfig();
  const ids = reserved.map((r) => r.productId);
  const rows = await tx
    .select({ id: products.id, name: products.name, n: sql<number>`count(${cards.id})::int` })
    .from(products)
    .leftJoin(cards, and(eq(cards.productId, products.id), eq(cards.status, "available")))
    .where(inArray(products.id, ids))
    .groupBy(products.id, products.name);
  for (const r of rows) {
    const after = Number(r.n);
    const before = after + (reserved.find((x) => x.productId === r.id)?.quantity ?? 0);
    const soldOut = after === 0 && before > 0;
    const crossed = after < lowStockThreshold && before >= lowStockThreshold;
    if (soldOut || crossed) {
      await enqueue(
        tx,
        "stock_low",
        soldOut
          ? `📦 已售罄：${r.name}\n可售卡密为 0，前台显示缺货。请到「卡密」页导入。`
          : `📦 库存偏低：${r.name}\n可售剩 ${after} 张（提醒阈值 ${lowStockThreshold}）。`
      );
    }
  }
}

/* ===== 投递 ===== */

export interface TelegramResult {
  ok: boolean;
  error?: string;
}

export async function sendTelegram(token: string, chatId: string, text: string): Promise<TelegramResult> {
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(10_000),
    });
    const json = (await res.json().catch(() => null)) as { ok?: boolean; description?: string } | null;
    if (res.ok && json?.ok) return { ok: true };
    // 错误信息里不能带令牌（URL 里有）；只回传 Telegram 的描述
    return { ok: false, error: `HTTP ${res.status} ${json?.description ?? ""}`.trim() };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg.replaceAll(token, "***") };
  }
}

async function telegramTarget(): Promise<{ token: string; chatId: string } | null> {
  const c = await getConfig();
  const token = revealSecret(c.telegramBotTokenEnc);
  return c.telegramEnabled && token && c.telegramChatId ? { token, chatId: c.telegramChatId } : null;
}

/** cron 调用：投递待发通知 */
export async function flushNotifications(limit = 20): Promise<{ sent: number; failed: number; skipped: boolean }> {
  const target = await telegramTarget();
  if (!target) return { sent: 0, failed: 0, skipped: true };

  // 超过 24 小时未发出的积压直接放弃（标记 attempts 上限，保留记录供排查）
  await db
    .update(notifications)
    .set({ attempts: MAX_ATTEMPTS, lastError: "积压超过 24 小时，已放弃投递" })
    .where(
      and(isNull(notifications.sentAt), lt(notifications.attempts, MAX_ATTEMPTS), lt(notifications.createdAt, new Date(Date.now() - STALE_MS)))
    );

  const pending = await db
    .select()
    .from(notifications)
    .where(and(isNull(notifications.sentAt), lt(notifications.attempts, MAX_ATTEMPTS)))
    .orderBy(asc(notifications.id))
    .limit(limit);
  let sent = 0;
  let failed = 0;
  for (const n of pending) {
    const r = await sendTelegram(target.token, target.chatId, n.text);
    if (r.ok) {
      await db.update(notifications).set({ sentAt: new Date(), lastError: null }).where(eq(notifications.id, n.id));
      sent += 1;
    } else {
      await db
        .update(notifications)
        .set({ attempts: sql`${notifications.attempts} + 1`, lastError: (r.error ?? "unknown").slice(0, 500) })
        .where(eq(notifications.id, n.id));
      failed += 1;
    }
  }
  return { sent, failed, skipped: false };
}

/** 后台「发送测试消息」：直接发送（不入发件箱），返回 Telegram 的结果 */
export async function sendTestNotification(): Promise<TelegramResult> {
  const target = await telegramTarget();
  if (!target) return { ok: false, error: "请先启用并填写 Bot Token 与 Chat ID" };
  const siteName = (await getConfig()).siteName || "liteshop";
  return sendTelegram(target.token, target.chatId, `✅ ${siteName} 运营通知测试\n收到这条说明配置正确。`);
}
