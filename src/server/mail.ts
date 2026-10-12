import nodemailer from "nodemailer";
import { and, eq } from "drizzle-orm";
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

export interface MailSendResult {
  ok: boolean;
  skipped?: boolean;
  error?: string;
}

/**
 * 发送订单邮件（每订单每类只发一次：mail_logs 唯一约束幂等）。
 * force=true 用于后台「补发邮件」（删除旧记录后重发）。
 */
export async function sendOrderEmail(orderNo: string, kind: MailKind, force = false): Promise<MailSendResult> {
  const smtp = getSmtpConfig();
  if (!smtp.enabled) {
    return { ok: false, skipped: true, error: "SMTP 未启用或未配置完整" };
  }

  const order = db.select().from(orders).where(eq(orders.orderNo, orderNo)).get();
  if (!order) return { ok: false, error: "订单不存在" };

  // 幂等：已成功发过且非强制 → 跳过
  const existing = db
    .select()
    .from(mailLogs)
    .where(and(eq(mailLogs.orderNo, orderNo), eq(mailLogs.kind, kind)))
    .get();
  if (existing && !force) {
    return { ok: false, skipped: true, error: existing.status === "sent" ? "该邮件已发送过" : existing.error };
  }

  const mail = renderOrderMail(order, kind);
  try {
    await deliver(smtp, order.email, mail.subject, mail.text, mail.html);
    db.insert(mailLogs)
      .values({ orderNo, kind, email: order.email, status: "sent", error: "" })
      .onConflictDoUpdate({
        target: [mailLogs.orderNo, mailLogs.kind],
        set: { status: "sent", error: "", createdAt: new Date() },
      })
      .run();
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    db.insert(mailLogs)
      .values({ orderNo, kind, email: order.email, status: "failed", error: message.slice(0, 500) })
      .onConflictDoUpdate({
        target: [mailLogs.orderNo, mailLogs.kind],
        set: { status: "failed", error: message.slice(0, 500), createdAt: new Date() },
      })
      .run();
    return { ok: false, error: message };
  }
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
<p>该商品为人工发货，我们会尽快处理；完成后将发送交付内容至本邮箱。<br>您也可以随时凭「订单号 + 下单邮箱」在 <a href="${lookupUrl}">订单查询</a> 页查看进度。</p>`;
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
<p>查询订单：<a href="${lookupUrl}">订单查询</a></p>`;
  return { subject, text, html };
}

function row(label: string, value: string): string {
  return `<tr><td style="padding:4px 12px 4px 0;color:#787774;font-size:13px">${label}</td><td style="font-size:13px">${value}</td></tr>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}
