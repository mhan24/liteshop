"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, assertCsrf, SESSION_TTL_SECONDS } from "@/lib/session";
import { getAdminBase } from "@/lib/admin-path";
import {
  changeAdminCredentials,
  currentSession,
  login as doLogin,
  lockedForSeconds,
  recordFailure,
} from "@/server/auth";
import { logAdmin } from "@/server/admin-log";
import {
  clearAvailableCards,
  createProduct,
  deleteAvailableCards,
  deleteProduct,
  importCards,
  setProductStatus,
  updateProduct,
} from "@/server/admin/catalog";
import { closeOrder, manualDeliver, retryAutoDelivery } from "@/server/order/fulfill-order";
import { sendOrderEmail, sendTestEmail } from "@/server/mail";
import { setSetting, upsertPaymentConfig, SETTING_KEYS } from "@/server/settings";

/** 后台 Server Actions：全部经 session 鉴权 + CSRF 校验 + 审计日志 + service 层落库 */

async function requireSession() {
  const jar = await cookies();
  const session = await currentSession(jar.get(ADMIN_COOKIE)?.value);
  if (!session) redirect("/admin/login");
  return session;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "-";
}

/** 跳回来源页（/admin/... 内部路径自动换算为当前伪装入口） */
async function back(path: string, msg: string, ok: boolean): Promise<never> {
  const base = await getAdminBase();
  const rest = path.startsWith("/admin") ? path.slice("/admin".length) : path;
  redirect(`${base}${rest}?${ok ? "ok" : "err"}=${encodeURIComponent(msg)}`);
}

/* ===== 登录/登出 ===== */

export async function loginAction(_prev: { error?: string } | null, formData: FormData) {
  const username = String(formData.get("username") ?? "");
  const password = String(formData.get("password") ?? "");
  const h = await headers();
  const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "-";

  const locked = lockedForSeconds(ip, username);
  if (locked > 0) {
    return { error: `失败次数过多，请 ${Math.ceil(locked / 60)} 分钟后再试` };
  }

  const result = await doLogin(ip, username, password);
  if (!result.ok || !result.token) {
    recordFailure(ip, username);
    return { error: result.message };
  }
  const jar = await cookies();
  const secure = h.get("x-forwarded-proto") === "https";
  jar.set(ADMIN_COOKIE, result.token, {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: result.maxAge ?? SESSION_TTL_SECONDS,
  });
  logAdmin("login", username, "管理员登录", ip);
  const next = String(formData.get("next") ?? "");
  if (next.startsWith("/")) redirect(next);
  redirect(await getAdminBase());
}

export async function logoutAction() {
  await requireSession();
  const jar = await cookies();
  jar.delete(ADMIN_COOKIE);
  redirect(`${await getAdminBase()}/login`);
}

/* ===== 商品管理 ===== */

export async function saveProductAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"));
  const ip = await clientIp();
  const input = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    imageUrl: String(formData.get("imageUrl") ?? ""),
    priceCentsText: String(formData.get("price") ?? ""),
    deliveryType: String(formData.get("deliveryType") ?? "auto"),
    stockLimit: Number(formData.get("stockLimit") ?? 0),
    status: String(formData.get("status") ?? "on"),
    sort: Number(formData.get("sort") ?? 0),
  };
  const id = Number(formData.get("id") ?? 0);
  const result = id > 0 ? updateProduct(id, input) : createProduct(input);
  logAdmin(id > 0 ? "product.update" : "product.create", String(id || input.name), result.message, ip);
  revalidatePath("/admin/products");
  revalidatePath("/");
  await back("/admin/products", result.message, result.ok);
}

export async function toggleProductStatusAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"));
  const id = Number(formData.get("id") ?? 0);
  const status = String(formData.get("status") ?? "on") === "off" ? "off" : "on";
  setProductStatus(id, status);
  logAdmin("product.status", String(id), `上下架 → ${status}`, await clientIp());
  revalidatePath("/admin/products");
  revalidatePath("/");
}

export async function deleteProductAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"));
  const id = Number(formData.get("id") ?? 0);
  const result = deleteProduct(id);
  logAdmin("product.delete", String(id), result.message, await clientIp());
  revalidatePath("/admin/products");
  await back("/admin/products", result.message, result.ok);
}

/* ===== 卡密管理 ===== */

export async function importCardsAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"));
  const productId = Number(formData.get("productId") ?? 0);
  const raw = String(formData.get("content") ?? "");
  const result = importCards(productId, raw);
  logAdmin("cards.import", String(productId), result.message, await clientIp());
  revalidatePath("/admin/cards");
  await back(`/admin/cards?product=${productId}`, result.message, result.imported > 0 || result.duplicates > 0);
}

export async function deleteCardsAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"));
  const productId = Number(formData.get("productId") ?? 0);
  const ids = formData.getAll("ids").map(Number).filter(Number.isInteger);
  const n = deleteAvailableCards(productId, ids);
  logAdmin("cards.delete", String(productId), `删除未使用卡密 ${n} 张`, await clientIp());
  revalidatePath("/admin/cards");
  await back(`/admin/cards?product=${productId}`, `已删除 ${n} 张未使用卡密`, true);
}

export async function clearCardsAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"));
  const productId = Number(formData.get("productId") ?? 0);
  const n = clearAvailableCards(productId);
  logAdmin("cards.clear", String(productId), `清空未使用卡密 ${n} 张`, await clientIp());
  revalidatePath("/admin/cards");
  await back(`/admin/cards?product=${productId}`, `已清空 ${n} 张未使用卡密`, true);
}

/* ===== 订单管理 ===== */

export async function manualDeliverAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const orderNo = String(formData.get("orderNo") ?? "");
  const content = String(formData.get("content") ?? "");
  const result = manualDeliver(orderNo, content);
  logAdmin("order.manual_deliver", orderNo, result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders", await withMailNote(orderNo, result), result.ok);
}

export async function retryDeliveryAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const orderNo = String(formData.get("orderNo") ?? "");
  const result = retryAutoDelivery(orderNo);
  logAdmin("order.retry", orderNo, result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders", await withMailNote(orderNo, result), result.ok);
}

export async function closeOrderAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const orderNo = String(formData.get("orderNo") ?? "");
  const result = closeOrder(orderNo);
  logAdmin("order.close", orderNo, result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders", result.message, result.ok);
}

/** 交付类操作成功后尝试发送邮件，结果附在提示信息里 */
async function withMailNote(
  orderNo: string,
  result: { ok: boolean; message: string; emailKind?: "delivered" | "processing" }
): Promise<string> {
  if (!result.ok || !result.emailKind) return result.message;
  try {
    const mail = await sendOrderEmail(orderNo, result.emailKind);
    if (mail.ok) return `${result.message}；已发送通知邮件`;
    if (mail.skipped) return `${result.message}；（邮件未发送：${mail.error}）`;
    return `${result.message}；（邮件发送失败：${mail.error}）`;
  } catch (err) {
    return `${result.message}；（邮件发送异常：${err instanceof Error ? err.message : String(err)}）`;
  }
}

/** 补发交付邮件（已完成订单，强制重发） */
export async function resendDeliveryEmailAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const orderNo = String(formData.get("orderNo") ?? "");
  const mail = await sendOrderEmail(orderNo, "delivered", true);
  logAdmin(
    "order.mail_resend",
    orderNo,
    mail.ok ? "已补发交付邮件" : `补发失败：${mail.error ?? ""}`,
    await clientIp(),
    session.u
  );
  revalidatePath("/admin/orders");
  await back("/admin/orders", mail.ok ? "交付邮件已补发" : `补发失败：${mail.error ?? "未知错误"}`, mail.ok);
}

/* ===== 设置 ===== */

export async function saveSiteSettingsAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const siteName = String(formData.get("siteName") ?? "").trim().slice(0, 60);
  const siteUrl = String(formData.get("siteUrl") ?? "").trim().slice(0, 200);
  const threshold = Math.max(0, Math.trunc(Number(formData.get("threshold") ?? 5)) || 0);
  setSetting(SETTING_KEYS.siteName, siteName);
  setSetting(SETTING_KEYS.siteUrl, siteUrl.replace(/\/+$/, ""));
  setSetting(SETTING_KEYS.cardLowStockThreshold, String(threshold));
  logAdmin("settings.site", "-", JSON.stringify({ siteName, siteUrl, threshold }), await clientIp(), session.u);
  revalidatePath("/admin/settings");
  await back("/admin/settings", "站点设置已保存", true);
}

export async function savePaymentConfigAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const provider = String(formData.get("provider") ?? "");
  if (provider !== "bepusdt") await back("/admin/settings", "未知支付渠道", false);

  const enabled = String(formData.get("enabled") ?? "") === "on";
  const configJson: Record<string, unknown> = {
    api_base: String(formData.get("apiBase") ?? "").trim(),
    token: String(formData.get("token") ?? "").trim(),
    fiat: "CNY",
    timeout_seconds: Math.max(180, Math.trunc(Number(formData.get("timeout") ?? 600)) || 600),
  };
  upsertPaymentConfig(provider, { enabled, configJson });
  logAdmin("settings.payment", provider, `enabled=${enabled}`, await clientIp(), session.u);
  revalidatePath("/admin/settings");
  await back("/admin/settings", "支付渠道配置已保存", true);
}

/* ===== SMTP 邮件 ===== */

export async function saveSmtpSettingsAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const enabled = String(formData.get("smtpEnabled") ?? "") === "on";
  const host = String(formData.get("smtpHost") ?? "").trim();
  const portRaw = String(formData.get("smtpPort") ?? "").trim();
  const port = Number(portRaw);
  const from = String(formData.get("smtpFrom") ?? "").trim();

  if (enabled) {
    if (host === "") await back("/admin/settings", "启用邮件通知需填写 SMTP 服务器地址", false);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      await back("/admin/settings", "SMTP 端口需为 1-65535 的整数", false);
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) && !/^[^@\s]+<[^@\s]+>$/.test(from)) {
      await back("/admin/settings", "发件人格式无效（如 noreply@example.com 或 Site <noreply@example.com>）", false);
    }
  }

  setSetting("smtp_enabled", enabled ? "1" : "0");
  setSetting("smtp_host", host);
  setSetting("smtp_port", portRaw === "" ? "465" : String(port));
  setSetting("smtp_secure", String(formData.get("smtpSecure") ?? "") === "on" ? "1" : "0");
  setSetting("smtp_user", String(formData.get("smtpUser") ?? "").trim());
  setSetting("smtp_pass", String(formData.get("smtpPass") ?? ""));
  setSetting("smtp_from", from);
  logAdmin("settings.smtp", "-", `enabled=${enabled}`, await clientIp(), session.u);
  revalidatePath("/admin/settings");
  await back("/admin/settings", "邮件通知设置已保存", true);
}

export async function sendTestEmailAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const to = String(formData.get("testTo") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    await back("/admin/settings", "请输入有效的测试收件邮箱", false);
  }
  const result = await sendTestEmail(to);
  logAdmin("settings.smtp_test", to, result.ok ? "测试邮件已发送" : `失败：${result.error ?? ""}`, await clientIp(), session.u);
  await back("/admin/settings", result.ok ? `测试邮件已发送至 ${to}` : `发送失败：${result.error ?? "未知错误"}`, result.ok);
}

/* ===== 管理员凭据 / 入口路径 ===== */

export async function changeAdminCredentialsAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"));
  const currentPassword = String(formData.get("currentPassword") ?? "");
  const newUsername = String(formData.get("newUsername") ?? "");
  const newPassword = String(formData.get("newPassword") ?? "");
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const newPath = String(formData.get("newPath") ?? "");

  if (newPassword !== "" && newPassword !== confirmPassword) {
    await back("/admin/settings", "两次输入的新密码不一致", false);
  }

  const result = changeAdminCredentials({
    currentPassword,
    newUsername,
    newPassword,
    newPath,
  });
  logAdmin("admin.credentials", newUsername || "-", result.message, await clientIp(), session.u);
  revalidatePath("/admin/settings");
  if (result.ok) {
    // 全部会话已失效 → 回登录页；若改了入口路径，必须用新路径（旧路径此刻已 404）
    const base =
      newPath.trim() !== "" ? `/${newPath.trim().toLowerCase()}` : await getAdminBase();
    redirect(`${base}/login?msg=${encodeURIComponent(result.message)}`);
  }
  await back("/admin/settings", result.message, result.ok);
}
