import nodemailer from "nodemailer";
import { getSiteName, getSmtpConfig, type SmtpConfig } from "./settings";
import {
  markDeliveryEmailFailed,
  markDeliveryEmailSent,
  pendingDeliveryEmails,
} from "./orders";

/** 邮件通知：交付内容发送 + 重试（deliveries 表持久化 attempts，cron 兜底重投） */

export interface SendResult {
  ok: boolean;
  error?: string;
}

function createTransport(cfg: SmtpConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: cfg.user ? { user: cfg.user, pass: cfg.pass } : undefined,
    connectionTimeout: 15_000,
  });
}

async function sendMail(cfg: SmtpConfig, to: string, subject: string, text: string): Promise<SendResult> {
  if (!cfg.enabled || !cfg.host || !cfg.from) {
    return { ok: false, error: "SMTP 未启用或配置不完整" };
  }
  try {
    const transport = createTransport(cfg);
    await transport.sendMail({
      from: cfg.from,
      to,
      subject,
      text,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** 交付邮件（内容即卡密文本） */
export async function sendDeliveryEmail(orderNo: string, email: string, content: string): Promise<SendResult> {
  const cfg = await getSmtpConfig();
  const siteName = await getSiteName();
  const text = [
    `您在 ${siteName} 的订单已完成发货。`,
    "",
    `订单号：${orderNo}`,
    "",
    "卡密内容（请妥善保存）：",
    "",
    content,
    "",
    "—",
    "如需再次查看，请访问商店「订单查询」页，凭订单号、下单邮箱和查单密码查询。",
  ].join("\n");
  return sendMail(cfg, email, `【${siteName}】卡密已发放 · ${orderNo}`, text);
}

/** 发送测试邮件（后台 SMTP 设置） */
export async function sendTestEmail(to: string): Promise<SendResult> {
  const cfg = await getSmtpConfig();
  const siteName = await getSiteName();
  return sendMail(cfg, to, `【${siteName}】SMTP 测试邮件`, "这是一封测试邮件。收到此邮件说明 SMTP 配置正常，后续卡密将按此通道发送。");
}

/** cron / 交付后调用：投递所有待发送邮件（幂等，attempts < 5） */
export async function flushDeliveryEmails(limit = 50): Promise<{ sent: number; failed: number }> {
  const rows = await pendingDeliveryEmails(limit);
  let sent = 0;
  let failed = 0;
  for (const row of rows) {
    if (!row.content.trim()) continue;
    const result = await sendDeliveryEmail(row.orderNo, row.email, row.content);
    if (result.ok) {
      await markDeliveryEmailSent(row.deliveryId);
      sent += 1;
    } else {
      await markDeliveryEmailFailed(row.deliveryId, result.error ?? "unknown");
      failed += 1;
    }
  }
  return { sent, failed };
}
