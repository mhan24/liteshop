"use server";

import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { ADMIN_COOKIE, assertCsrf, SESSION_TTL_SECONDS } from "@/lib/session";
import { getAdminBase } from "@/lib/admin-path";
import { putFlash } from "@/lib/flash-store";
import {
  changeAdminCredentials,
  currentSession,
  login as doLogin,
  lockedForSeconds,
  recordFailure,
  getSessionVersion,
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
import {
  closeOrder,
  manualDeliver,
  retryAutoDelivery,
  resolveReconcilingAsNotCreated,
} from "@/server/order/fulfill-order";
import { sendOrderEmail, sendTestEmail } from "@/server/mail";
import { getPaymentConfig, getSetting, setSetting, upsertPaymentConfig, SETTING_KEYS } from "@/server/settings";
import {
  reissueAnomaly,
  acceptAnomalyForManualDelivery,
  resolveAnomalyAs,
} from "@/server/admin/anomalies";
import { clampBepusdtTimeout } from "@/server/payment/bepusdt";
import { COPY_KEYS, setCopy } from "@/server/copy";
import { SUPPORTED_CURRENCIES } from "@/lib/money";
import { STOCK_UNLIMITED } from "@/lib/stock";

/** 后台 Server Actions：全部经 session 鉴权 + CSRF 校验 + 审计日志 + service 层落库 */

/**
 * 解析商品表单的库存输入。
 * 表单留空提交的是空字符串（不是 null），而 Number("") === 0
 * 会被当成「售罄」——必须先判空，留空/非法一律返回 -1（不限）。
 */
function parseStockLimitInput(raw: FormDataEntryValue | null): number {
  const s = String(raw ?? "").trim();
  if (s === "") return STOCK_UNLIMITED;
  const n = Number(s);
  if (!Number.isFinite(n)) return STOCK_UNLIMITED;
  return Math.trunc(n) < 0 ? STOCK_UNLIMITED : Math.trunc(n);
}

async function requireSession() {
  const jar = await cookies();
  const session = await currentSession(jar.get(ADMIN_COOKIE)?.value);
  // 必须走实际入口（admin_path 可自定义，硬编码 /admin 在伪装后会被中间件 404）
  if (!session) redirect(`${await getAdminBase()}/login`);
  return session;
}

async function clientIp(): Promise<string> {
  const h = await headers();
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? "-";
}

/** 跳回来源页（/admin/... 内部路径自动换算为当前伪装入口）；提示走一次性 Flash（URL 仅含随机 ID） */
async function back(path: string, msg: string, ok: boolean): Promise<never> {
  const base = await getAdminBase();
  const rest = path.startsWith("/admin") ? path.slice("/admin".length) : path;
  const id = putFlash(ok ? { ok: msg } : { err: msg });
  redirect(`${base}${rest}?flash=${id}`);
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
  if (isSafeInternalPath(next)) redirect(next);
  redirect(await getAdminBase());
}

/**
 * 仅允许站内相对路径，防开放重定向。
 * 注意不能只用 startsWith("/")：`//evil.com` 也是以 / 开头，
 * 但它是协议相对 URL，浏览器会跳转到站外（钓鱼常用手法）。
 */
function isSafeInternalPath(p: string): boolean {
  if (!p.startsWith("/")) return false;
  if (p.startsWith("//")) return false; // 协议相对 URL
  if (p.includes("\\")) return false; // 反斜杠可能被浏览器规范化成 //
  if (/[\u0000-\u001f]/.test(p)) return false; // 控制字符
  return true;
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
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const ip = await clientIp();
  const input = {
    name: String(formData.get("name") ?? ""),
    slug: String(formData.get("slug") ?? ""),
    description: String(formData.get("description") ?? ""),
    imageUrl: String(formData.get("imageUrl") ?? ""),
    priceCentsText: String(formData.get("price") ?? ""),
    // 币种必须从表单读取，否则弹窗里选的币种不会保存（新建恒为站点默认）
    currency: String(formData.get("currency") ?? ""),
    deliveryType: String(formData.get("deliveryType") ?? "auto"),
    // 留空 = 不限（-1）。注意表单留空提交的是空字符串 ""（不是 null），
    // 而 Number("") === 0 会被误解为「售罄」，因此必须先判空再转数字。
    stockLimit: parseStockLimitInput(formData.get("stockLimit")),
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
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const id = Number(formData.get("id") ?? 0);
  const status = String(formData.get("status") ?? "on") === "off" ? "off" : "on";
  setProductStatus(id, status);
  logAdmin("product.status", String(id), `上下架 → ${status}`, await clientIp());
  revalidatePath("/admin/products");
  revalidatePath("/");
}

export async function deleteProductAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const id = Number(formData.get("id") ?? 0);
  const result = deleteProduct(id);
  logAdmin("product.delete", String(id), result.message, await clientIp());
  revalidatePath("/admin/products");
  await back("/admin/products", result.message, result.ok);
}

/* ===== 卡密管理 ===== */

export async function importCardsAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const productId = Number(formData.get("productId") ?? 0);
  const raw = String(formData.get("content") ?? "");
  const result = importCards(productId, raw);
  logAdmin("cards.import", String(productId), result.message, await clientIp());
  revalidatePath("/admin/cards");
  await back(`/admin/cards?product=${productId}`, result.message, result.imported > 0);
}

export async function deleteCardsAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const productId = Number(formData.get("productId") ?? 0);
  const ids = formData.getAll("ids").map(Number).filter(Number.isInteger);
  const n = deleteAvailableCards(productId, ids);
  logAdmin("cards.delete", String(productId), `删除未使用卡密 ${n} 张`, await clientIp());
  revalidatePath("/admin/cards");
  await back(`/admin/cards?product=${productId}`, `已删除 ${n} 张未使用卡密`, true);
}

export async function clearCardsAction(formData: FormData) {
  await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const productId = Number(formData.get("productId") ?? 0);
  const n = clearAvailableCards(productId);
  logAdmin("cards.clear", String(productId), `清空未使用卡密 ${n} 张`, await clientIp());
  revalidatePath("/admin/cards");
  await back(`/admin/cards?product=${productId}`, `已清空 ${n} 张未使用卡密`, true);
}

/* ===== 订单管理 ===== */

export async function manualDeliverAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const orderNo = String(formData.get("orderNo") ?? "");
  const content = String(formData.get("content") ?? "");
  const result = manualDeliver(orderNo, content);
  logAdmin("order.manual_deliver", orderNo, result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders", await withMailNote(orderNo, result), result.ok);
}

export async function retryDeliveryAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const orderNo = String(formData.get("orderNo") ?? "");
  const result = retryAutoDelivery(orderNo);
  logAdmin("order.retry", orderNo, result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders", await withMailNote(orderNo, result), result.ok);
}

export async function closeOrderAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const orderNo = String(formData.get("orderNo") ?? "");
  const result = closeOrder(orderNo);
  logAdmin("order.close", orderNo, result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders", result.message, result.ok);
}

/**
 * 待对账订单：确认网关**未建单** → 关闭并释放库存。
 * 这是 reconciling 状态释放库存的唯一安全途径（需人工核对网关后台）。
 */
export async function resolveReconcilingAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const orderNo = String(formData.get("orderNo") ?? "");
  const result = resolveReconcilingAsNotCreated(orderNo);
  logAdmin("order.reconcile", orderNo, result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders", result.message, result.ok);
}

/* ===== 异常到账（超时后到账）处置 ===== */

/** 补发商品：从卡池重新取卡交付（不恢复已被释放的那张卡） */
export async function reissueAnomalyAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const id = Number(formData.get("id") ?? 0);
  const note = String(formData.get("note") ?? "");
  const result = reissueAnomaly(id, note);
  logAdmin("anomaly.reissue", String(id), result.message, await clientIp(), session.u);
  // 补发成功需通知买家（复用交付邮件；失败不阻断）
  const orderNo = String(formData.get("orderNo") ?? "");
  let message = result.message;
  if (result.ok && orderNo) {
    try {
      const mail = await sendOrderEmail(orderNo, "delivered", true);
      if (mail.ok) message += "；已发送交付邮件";
    } catch {
      /* 邮件失败不影响补发结果 */
    }
  }
  revalidatePath("/admin/orders");
  await back("/admin/orders?anomaly=open", message, result.ok);
}

/** 人工发货商品：核实到账后转入待人工发货 */
export async function acceptAnomalyManualAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const id = Number(formData.get("id") ?? 0);
  const note = String(formData.get("note") ?? "");
  const result = acceptAnomalyForManualDelivery(id, note);
  logAdmin("anomaly.manual", String(id), result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders?anomaly=open", result.message, result.ok);
}

/** 标记为已退款 / 误报（仅记录，不执行资金操作） */
export async function resolveAnomalyAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const id = Number(formData.get("id") ?? 0);
  const kind = String(formData.get("kind") ?? "") === "refunded" ? "refunded" : "dismissed";
  const note = String(formData.get("note") ?? "");
  // 系统不会自动退款：标记为「已退款」时必须留下链上凭证，避免误以为已完成
  if (kind === "refunded" && note.trim().length < 8) {
    await back(
      "/admin/orders?anomaly=open",
      "标记已退款需填写退款交易哈希或凭证（至少 8 字符）",
      false
    );
  }
  const result = resolveAnomalyAs(id, kind, note);
  logAdmin(`anomaly.${kind}`, String(id), result.message, await clientIp(), session.u);
  revalidatePath("/admin/orders");
  await back("/admin/orders?anomaly=open", result.message, result.ok);
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
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
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
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const siteName = String(formData.get("siteName") ?? "").trim().slice(0, 60);
  const siteUrl = String(formData.get("siteUrl") ?? "").trim().slice(0, 200);
  const threshold = Math.max(0, Math.trunc(Number(formData.get("threshold") ?? 5)) || 0);
  const currency = String(formData.get("currency") ?? "").trim().toUpperCase();
  if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    await back("/admin/settings", `不支持的币种: ${currency}`, false);
  }
  setSetting(SETTING_KEYS.siteName, siteName);
  setSetting(SETTING_KEYS.siteUrl, siteUrl.replace(/\/+$/, ""));
  setSetting(SETTING_KEYS.cardLowStockThreshold, String(threshold));
  setSetting(SETTING_KEYS.currency, currency);
  logAdmin("settings.site", "-", JSON.stringify({ siteName, siteUrl, threshold, currency }), await clientIp(), session.u);
  revalidatePath("/admin/settings");
  await back("/admin/settings", "站点设置已保存", true);
}

export async function savePaymentConfigAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const provider = String(formData.get("provider") ?? "");
  if (provider !== "bepusdt") await back("/admin/settings", "未知支付渠道", false);

  const enabled = String(formData.get("enabled") ?? "") === "on";
  const apiBase = String(formData.get("apiBase") ?? "").trim();
  const submittedToken = String(formData.get("token") ?? "").trim();
  // 表单不回显令牌 → 留空表示保持原值；__CLEAR__ 表示清除
  const existingToken =
    String((getPaymentConfig("bepusdt")?.configJson?.["token"] as string | undefined) ?? "").trim();
  const token =
    submittedToken === "__CLEAR__" ? "" : submittedToken === "" ? existingToken : submittedToken;

  // 启用却缺少必填项会导致全站无法下单（createPayment 抛错 → 每单都被补偿关单），
  // 因此在保存时就拦下，避免把站点置于「支付中断」状态。
  if (enabled) {
    if (apiBase === "") {
      await back("/admin/settings", "启用支付渠道前请填写 API 地址", false);
    }
    if (token === "") {
      await back("/admin/settings", "启用支付渠道前请填写对接令牌", false);
    }
    if (!/^https?:\/\/.+/i.test(apiBase)) {
      await back("/admin/settings", "API 地址需以 http:// 或 https:// 开头", false);
    }
  }

  const configJson: Record<string, unknown> = {
    api_base: apiBase,
    token,
    // 与网关 CalcTradeExpiredAt 的 [180, 3600] 边界对齐（越界网关会静默回落）
    timeout_seconds: clampBepusdtTimeout(Number(formData.get("timeout") ?? 900)),
  };
  upsertPaymentConfig(provider, { enabled, configJson });
  logAdmin("settings.payment", provider, `enabled=${enabled}`, await clientIp(), session.u);
  revalidatePath("/admin/settings");
  await back("/admin/settings", "支付渠道配置已保存", true);
}

/* ===== SMTP 邮件 ===== */

export async function saveSmtpSettingsAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
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
  // 留空 = 保持原密码。
  // 表单不再回填明文密码（避免页面源码泄露），因此留空是"不修改"而非"清空"；
  // 需要清除密码时提交特殊标记 __CLEAR__。
  const smtpPassInput = String(formData.get("smtpPass") ?? "");
  if (smtpPassInput === "__CLEAR__") {
    setSetting("smtp_pass", "");
  } else if (smtpPassInput !== "") {
    setSetting("smtp_pass", smtpPassInput);
  }
  setSetting("smtp_from", from);
  logAdmin("settings.smtp", "-", `enabled=${enabled}`, await clientIp(), session.u);
  revalidatePath("/admin/settings");
  await back("/admin/settings", "邮件通知设置已保存", true);
}

export async function sendTestEmailAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const to = String(formData.get("testTo") ?? "").trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    await back("/admin/settings", "请输入有效的测试收件邮箱", false);
  }
  const result = await sendTestEmail(to);
  logAdmin("settings.smtp_test", to, result.ok ? "测试邮件已发送" : `失败：${result.error ?? ""}`, await clientIp(), session.u);
  await back("/admin/settings", result.ok ? `测试邮件已发送至 ${to}` : `发送失败：${result.error ?? "未知错误"}`, result.ok);
}

/* ===== 人机验证（Cloudflare Turnstile）===== */

export async function saveTurnstileSettingsAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  const enabled = String(formData.get("turnstileEnabled") ?? "") === "on";
  const siteKey = String(formData.get("turnstileSiteKey") ?? "").trim();
  const submitted = String(formData.get("turnstileSecretKey") ?? "").trim();

  // 表单不再回显 Secret Key，因此「留空 = 保持原值」而非清空。
  // 需要清除时提交 __CLEAR__。（历史缺陷：回显会让密钥出现在页面源码中）
  const existing = getSetting("turnstile_secret_key")?.trim() ?? "";
  const secretKey = submitted === "__CLEAR__" ? "" : submitted === "" ? existing : submitted;

  if (enabled && (siteKey === "" || secretKey === "")) {
    await back("/admin/settings", "启用 Turnstile 需填写 Site Key 与 Secret Key", false);
  }
  setSetting("turnstile_enabled", enabled ? "1" : "0");
  setSetting("turnstile_site_key", siteKey);
  setSetting("turnstile_secret_key", secretKey);
  logAdmin("settings.turnstile", "-", `enabled=${enabled}`, await clientIp(), session.u);
  revalidatePath("/admin/settings");
  revalidatePath("/");
  await back("/admin/settings", "人机验证设置已保存", true);
}

/* ===== 前台文案 ===== */

export async function saveCopySettingsAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
  let changed = 0;
  for (const key of COPY_KEYS) {
    const raw = formData.get(`copy_${key}`);
    if (raw == null) continue;
    const value = String(raw).slice(0, 2000);
    setCopy(key, value);
    changed += 1;
  }
  logAdmin("settings.copy", "-", `${changed} 条文案已更新`, await clientIp(), session.u);
  revalidatePath("/admin/settings");
  revalidatePath("/");
  revalidatePath("/orders");
  await back("/admin/settings", `前台文案已保存（${changed} 条）`, true);
}

/* ===== 管理员凭据 / 入口路径 ===== */

export async function changeAdminCredentialsAction(formData: FormData) {
  const session = await requireSession();
  await assertCsrf(formData.get("csrf"), getSessionVersion(), await headers());
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
    redirect(`${base}/login?flash=${putFlash({ ok: result.message })}`);
  }
  await back("/admin/settings", result.message, result.ok);
}
