import nodemailer from "nodemailer";
import { and, eq, isNotNull, lt, lte, or, sql } from "drizzle-orm";
import { db, } from "@/db";
import { mailLogs, orders } from "@/db/schema";
import type { Order } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { getSetting, getSiteName, getSiteUrl } from "@/server/settings";

/** 邮件通知：交易完成后向买家邮箱发送卡密 / 人工交付状态（SMTP 配置见后台设置） */

export const MAIL_KINDS = {
  /** 自动发卡交付 / 人工录入交付完成 */
  delivered: "delivered",
  /** 人工商品已支付、等待处理 */
  processing: "processing",
} as const;
export type MailKind = (typeof MAIL_KINDS)[keyof typeof MAIL_KINDS];

export interface SmtpConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
}

export function getSmtpConfig(): SmtpConfig {
  const s = (k: string) => getSetting(k)?.trim() ?? "";
  const port = Number(s("smtp_port")) || 465;
  return {
    enabled: s("smtp_enabled") === "1" && s("smtp_host") !== "" && s("smtp_from") !== "",
    host: s("smtp_host"),
    port,
    secure: s("smtp_secure") !== "0", // 默认 SSL(465)；显式填 0 走 STARTTLS(587)
    user: s("smtp_user"),
    pass: s("smtp_pass"),
    from: s("smtp_from"),
  };
}

/** 最大尝试次数（超过则不再自动重试，避免对坏地址无限发信） */
const MAX_ATTEMPTS = 5;
/** 重试退避（分钟）：第 n 次失败后等待的时长 */
const RETRY_BACKOFF_MINUTES = [1, 5, 30, 120, 360];
/** 「发送中」租约时长：超时后视为上次发送已崩溃，允许重新认领 */
const SENDING_LEASE_MS = 5 * 60 * 1000;

export interface MailSendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * 发送订单邮件（幂等 + 失败可重试 + 防并发重复）。
 *
 * 状态机：无记录 → sending（租约）→ sent / failed（带 nextRetryAt）
 *
 * 关键点：
 * - 只有 sent 才永久跳过；failed 会在退避到期后被重试（历史缺陷：
 *   任何已存在的记录都会导致跳过，首次失败后永远不再尝试）。
 * - 抢占式认领（条件 UPDATE 到 sending）保证并发调用只有一个真正发送。
 * - delivered 邮件必须订单已 completed，避免给未交付订单发「已完成」通知。
 */
export async function sendOrderEmail(orderNo: string, kind: MailKind, force = false): Promise<MailSendResult> {
  const smtp = getSmtpConfig();
  if (!smtp.enabled) {
    return { ok: false, skipped: true, error: "SMTP 未启用或未配置完整" };
  }

  const order = db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
  if (!order) return { ok: false, error: "订单不存在" };

  // 交付邮件必须确认订单确实已交付（防止误导买家/泄露空内容）
  if (kind === MAIL_KINDS.delivered && order.status !== "completed") {
    return { ok: false, skipped: true, error: `订单尚未完成（当前 ${order.status}），不发送交付邮件` };
  }

  const existing = db
    .select()
    .from(mailLogs)
    .where(and(eq(mailLogs.orderNo, orderNo), eq(mailLogs.kind, kind)))
    .get();

  if (existing && !force) {
    if (existing.status === "sent") {
      return { ok: false, skipped: true, error: "该邮件已发送过" };
    }
    // sending 且租约未过期 → 另一进程正在发，避免重复
    if (existing.status === "sending") {
      const claimedAt = existing.updatedAt?.getTime() ?? 0;
      if (Date.now() - claimedAt < SENDING_LEASE_MS) {
        return { ok: false, skipped: true, error: "该邮件正在发送中" };
      }
    }
    // failed：未到重试时间则跳过；超过最大次数则放弃
    if (existing.status === "failed" && !force) {
      if (existing.attempts >= MAX_ATTEMPTS) {
        return { ok: false, skipped: true, error: `已达最大重试次数（${MAX_ATTEMPTS}）` };
      }
      if (existing.nextRetryAt && existing.nextRetryAt.getTime() > Date.now()) {
        return { ok: false, skipped: true, error: "尚未到重试时间" };
      }
    }
  }

  // 抢占式认领：只有把状态成功改为 sending 的调用者才继续发送
  const claimed = claimForSending(existing?.id ?? null, orderNo, kind, order.email, force);
  if (!claimed) {
    return { ok: false, skipped: true, error: "该邮件正由其他任务发送" };
  }

  const attempts = (existing?.attempts ?? 0) + 1;
  const mail = renderOrderMail(order, kind);
  try {
    await deliver(smtp, order.email, mail.subject, mail.text, mail.html);
    db.update(mailLogs)
      .set({ status: "sent", error: "", attempts, nextRetryAt: null, updatedAt: new Date() })
      .where(and(eq(mailLogs.orderNo, orderNo), eq(mailLogs.kind, kind)))
      .run();
    return { ok: true };
  } catch (err) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    const backoff = RETRY_BACKOFF_MINUTES[Math.min(attempts - 1, RETRY_BACKOFF_MINUTES.length - 1)];
    const nextRetryAt =
      attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + backoff * 60_000);
    db.update(mailLogs)
      .set({ status: "failed", error: message, attempts, nextRetryAt, updatedAt: new Date() })
      .where(and(eq(mailLogs.orderNo, orderNo), eq(mailLogs.kind, kind)))
      .run();
    return { ok: false, error: message };
  }
}

/**
 * 认领发送权：插入新记录，或把已有 failed/sending(租约过期) 记录原子地置为 sending。
 * 返回 false 表示未被本调用者认领（并发安全）。
 */
function claimForSending(
  existingId: number | null,
  orderNo: string,
  kind: MailKind,
  email: string,
  force: boolean
): boolean {
  const now = new Date();
  if (existingId == null) {
    try {
      db.insert(mailLogs)
        .values({ orderNo, kind, email, status: "sending", attempts: 0, updatedAt: now })
        .run();
      return true;
    } catch {
      // 唯一约束冲突：并发插入，交给对方
      return false;
    }
  }

  // 条件更新：仅当仍处于可发送状态时才认领
  const leaseCutoff = new Date(Date.now() - SENDING_LEASE_MS);
  const cond = force
    ? eq(mailLogs.id, existingId)
    : and(
        eq(mailLogs.id, existingId),
        sql`(${mailLogs.status} = 'failed' OR (${mailLogs.status} = 'sending' AND ${mailLogs.updatedAt} < ${leaseCutoff.getTime()}))`
      );
  const res = db
    .update(mailLogs)
    .set({ status: "sending", updatedAt: now })
    .where(cond)
    .run();
  return Number(res.changes ?? 0) > 0;
}

/**
 * 定时重试失败的邮件（由 cron 调用）。
 * 只处理：status=failed 且已到 nextRetryAt 且未超最大次数。
 */
export async function retryFailedMails(limit = 20): Promise<{ retried: number; succeeded: number }> {
  // 两类可恢复记录：
  // 1) failed 且已到退避时间且未超最大次数
  // 2) sending 且租约已过期 —— 容器在发送过程中重启会留下这种记录，
  //    若不回收将永远卡住（历史缺陷：定时任务只查 failed）
  const leaseCutoff = new Date(Date.now() - SENDING_LEASE_MS);
  const rows = db
    .select()
    .from(mailLogs)
    .where(
      or(
        and(
          eq(mailLogs.status, "failed"),
          lt(mailLogs.attempts, MAX_ATTEMPTS),
          isNotNull(mailLogs.nextRetryAt),
          lte(mailLogs.nextRetryAt, new Date())
        ),
        and(
          eq(mailLogs.status, "sending"),
          lt(mailLogs.updatedAt, leaseCutoff),
          lt(mailLogs.attempts, MAX_ATTEMPTS)
        )
      )
    )
    .limit(limit)
    .all();

  let succeeded = 0;
  for (const r of rows) {
    const res = await sendOrderEmail(r.orderNo, r.kind as MailKind);
    if (res.ok) succeeded += 1;
  }
  return { retried: rows.length, succeeded };
}

/** 后台测试发信（发送到指定地址） */
export async function sendTestEmail(to: string): Promise<MailSendResult> {
  const smtp = getSmtpConfig();
  if (!smtp.enabled) return { ok: false, error: "SMTP 未启用或未配置完整" };
  const site = getSiteName();
  try {
    await deliver(
      smtp,
      to,
      `【${site}】SMTP 配置测试成功`,
      `这是一封来自 ${site} 的测试邮件。收到即代表 SMTP 配置正确，交易邮件将正常送达。`,
      `<p>这是一封来自 <b>${escapeHtml(site)}</b> 的测试邮件。收到即代表 SMTP 配置正确，交易邮件将正常送达。</p>`
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function deliver(
  smtp: SmtpConfig,
  to: string,
  subject: string,
  text: string,
  html: string
): Promise<void> {
  const transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  await transporter.sendMail({
    from: smtp.from,
    to,
    subject,
    text,
    html,
  });
}

function renderOrderMail(order: Order, kind: MailKind): { subject: string; text: string; html: string } {
  const site = getSiteName();
  const siteUrl = getSiteUrl();
  const lookupUrl = `${siteUrl}/orders`;
  const total = formatMoney(BigInt(order.totalCents), order.currency);
  const content = order.deliveryContent ?? "";

  if (kind === MAIL_KINDS.processing) {
    const subject = `【${site}】支付已确认 · 订单处理中`;
    const text = [
      `您的订单已成功支付，我们已收到款项。`,
      ``,
      `订单号：${order.orderNo}`,
      `商品：${order.productName} × ${order.quantity}`,
      `金额：${total}`,
      ``,
      `该商品为人工发货，我们会尽快处理；完成后将发送交付内容至本邮箱。`,
      `您也可以随时凭「订单号 + 下单邮箱」在 ${lookupUrl} 查询进度。`,
    ].join("\n");
    const html = `<p>您的订单已成功支付，我们已收到款项。</p>
<table>${row("订单号", `<code>${order.orderNo}</code>`)}${row("商品", `${escapeHtml(order.productName)} × ${order.quantity}`)}${row("金额", total)}</table>
<p>该商品为人工发货，我们会尽快处理；完成后将发送交付内容至本邮箱。<br>您也可以随时凭「订单号 + 下单邮箱」在 <a href="${escapeHtml(lookupUrl)}">订单查询</a> 页查看进度。</p>`;
    return { subject, text, html };
  }

  const subject = `【${site}】订单已完成 · 交付内容`;
  const text = [
    `您的订单已交付，以下为交付内容，请妥善保管：`,
    ``,
    content
      .split("\n")
      .map((l) => `  ${l}`)
      .join("\n"),
    ``,
    `──────────────────`,
    `订单号：${order.orderNo}`,
    `商品：${order.productName} × ${order.quantity}`,
    `金额：${total}`,
    `查询订单：${lookupUrl}`,
  ].join("\n");
  const html = `<p>您的订单已交付，以下为交付内容，请妥善保管：</p>
<pre style="background:#f7f6f3;border:1px solid #eaeaea;border-radius:8px;padding:16px;font-family:ui-monospace,monospace;font-size:13px;white-space:pre-wrap;word-break:break-all;">${escapeHtml(content)}</pre>
<hr style="border:none;border-top:1px solid #eaeaea">
<table>${row("订单号", `<code>${order.orderNo}</code>`)}${row("商品", `${escapeHtml(order.productName)} × ${order.quantity}`)}${row("金额", total)}</table>
<p>查询订单：<a href="${escapeHtml(lookupUrl)}">订单查询</a></p>`;
  return { subject, text, html };
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#787774;font-size:13px">${label}</td><td style="font-size:13px">${value}</td></tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
