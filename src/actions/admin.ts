"use server";

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { admins, categories, cards, products } from "@/db/schema";
import { normalizeHttpUrl } from "@/lib/http-url";
import { encryptSecret } from "@/lib/secret-box";
import {
  assertCsrf,
  audit,
  clearSessionCookie,
  createSessionCookie,
  hashPassword,
  loginAdmin,
  requireAdminSession,
  revokeAllSessions,
  verifyPassword,
} from "@/server/admin-auth";
import {
  adminCloseOrder,
  resolveReconcilingAsNotCreated,
  resolveReconcilingAsPaid,
  retryDelivery,
} from "@/server/orders";
import { sendTestEmail } from "@/server/mail";
import { sendTestNotification } from "@/server/notify";
import {
  DEFAULT_TIMEOUT_SECONDS,
  MAX_TIMEOUT_SECONDS,
  MIN_TIMEOUT_SECONDS,
} from "@/server/payments/litepay";
import { getConfig, updateConfig } from "@/server/settings";

/** 管理后台 Server Actions（统一 useActionState 内联反馈，POST 直返，无 GET 重定向） */

export interface AdminActionResult {
  ok: boolean;
  message: string;
}

async function withAdmin(
  fn: (session: { username: string }) => Promise<AdminActionResult>
): Promise<AdminActionResult> {
  try {
    const session = await requireAdminSession();
    return await fn(session);
  } catch (err) {
    if (err instanceof Error && err.message === "UNAUTHORIZED") {
      return { ok: false, message: "请先登录" };
    }
    throw err;
  }
}

async function checkCsrf(formData: FormData): Promise<AdminActionResult | null> {
  try {
    await assertCsrf(formData.get("csrf"));
    return null;
  } catch {
    return { ok: false, message: "会话已过期，请刷新页面后重试" };
  }
}

function revalidateStorefront(): void {
  revalidatePath("/", "layout");
}

/* ===== 登录 / 登出 ===== */

export async function loginAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  const username = String(formData.get("username") ?? "").trim();
  const password = String(formData.get("password") ?? "");
  if (!username || !password) return { ok: false, message: "请输入用户名与密码" };
  const session = await loginAdmin(username, password);
  if (!session) return { ok: false, message: "用户名或密码错误（连续失败 5 次将锁定 15 分钟）" };
  await createSessionCookie(session.username);
  await audit("admin.login", username, username);
  return { ok: true, message: "登录成功" };
}

export async function logoutAction(): Promise<void> {
  await clearSessionCookie();
}

/* ===== 分类 ===== */

const categorySchema = z.object({
  name: z.string().trim().min(1).max(50),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,63}$/)
    .optional(),
  description: z.string().max(500).default(""),
  sortOrder: z.coerce.number().int().min(0).max(9999).default(0),
});

export async function createCategoryAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const parsed = categorySchema.safeParse({
      name: formData.get("name"),
      slug: String(formData.get("slug") ?? "").trim() || undefined,
      description: String(formData.get("description") ?? ""),
      sortOrder: formData.get("sortOrder") ?? 0,
    });
    if (!parsed.success) return { ok: false, message: "请填写分类名称；URL 标识仅支持小写字母、数字和短横线" };
    const slug =
      parsed.data.slug ??
      (parsed.data.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 63) || `cat-${Date.now().toString(36)}`);
    try {
      await db.insert(categories).values({
        slug,
        name: parsed.data.name,
        description: parsed.data.description,
        sortOrder: parsed.data.sortOrder,
      });
    } catch {
      return { ok: false, message: "分类创建失败，该 URL 标识可能已存在" };
    }
    await audit("category.create", slug, session.username);
    revalidateStorefront();
    return { ok: true, message: "分类已创建" };
  });
}

export async function deleteCategoryAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id)) return { ok: false, message: "参数错误" };
    await db.delete(categories).where(eq(categories.id, id));
    await audit("category.delete", String(id), session.username);
    revalidateStorefront();
    return { ok: true, message: "分类已删除，其下商品已保留并设为无分类" };
  });
}

/* ===== 商品 ===== */

const productSchema = z.object({
  name: z.string().trim().min(1).max(200),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9][a-z0-9-]{1,127}$/),
  description: z.string().max(20_000).default(""),
  priceMinor: z.coerce.number().int().min(1).max(99_999_999),
  status: z.enum(["on", "off"]),
  imageUrl: z.string().trim().max(2000).optional(),
  seoDescription: z.string().trim().max(300).optional(),
  categoryId: z.coerce.number().int().positive().nullable(),
});

function parseProductForm(formData: FormData): z.infer<typeof productSchema> | null {
  const catRaw = String(formData.get("categoryId") ?? "").trim();
  const imageRaw = String(formData.get("imageUrl") ?? "").trim();
  // 商品图会渲染为 <img src> 与 og:image：只接受 http/https
  if (imageRaw && !normalizeHttpUrl(imageRaw)) return null;
  return productSchema.safeParse({
    name: formData.get("name"),
    slug: String(formData.get("slug") ?? "").trim(),
    description: String(formData.get("description") ?? ""),
    priceMinor: formData.get("priceMinor"),
    status: formData.get("status") === "off" ? "off" : "on",
    imageUrl: imageRaw || undefined,
    seoDescription: String(formData.get("seoDescription") ?? "").trim() || undefined,
    categoryId: catRaw === "" ? null : Number(catRaw),
  }).data ?? null;
}

export async function createProductAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const input = parseProductForm(formData);
    if (!input) return { ok: false, message: "商品信息不合法：请检查名称、URL 标识、价格（美分）及图片链接" };
    try {
      await db.insert(products).values({
        name: input.name,
        slug: input.slug,
        description: input.description,
        priceCents: input.priceMinor,
        status: input.status,
        imageUrl: input.imageUrl ?? null,
        seoDescription: input.seoDescription ?? null,
        categoryId: input.categoryId,
      });
    } catch {
      return { ok: false, message: "商品创建失败，该 URL 标识可能已存在" };
    }
    await audit("product.create", input.slug, session.username);
    revalidateStorefront();
    return { ok: true, message: "商品已创建" };
  });
}

export async function updateProductAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id)) return { ok: false, message: "参数错误" };
    const input = parseProductForm(formData);
    if (!input) return { ok: false, message: "商品信息不合法，请检查各字段格式" };
    try {
      await db
        .update(products)
        .set({
          name: input.name,
          slug: input.slug,
          description: input.description,
          priceCents: input.priceMinor,
          status: input.status,
          imageUrl: input.imageUrl ?? null,
          seoDescription: input.seoDescription ?? null,
          categoryId: input.categoryId,
          updatedAt: new Date(),
        })
        .where(eq(products.id, id));
    } catch {
      return { ok: false, message: "商品保存失败，该 URL 标识可能已被其他商品使用" };
    }
    await audit("product.update", input.slug, session.username);
    revalidateStorefront();
    return { ok: true, message: "商品已保存" };
  });
}

export async function deleteProductAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id)) return { ok: false, message: "参数错误" };
    // 有卡被订单锁定时不能删：级联删卡会让这些订单付款后无卡可发
    const held = await db
      .select({ id: cards.id })
      .from(cards)
      .where(and(eq(cards.productId, id), eq(cards.status, "reserved")))
      .limit(1);
    if (held[0]) return { ok: false, message: "该商品仍有卡密被未完成订单锁定，请先下架，待订单结束后再删除" };
    await db.delete(products).where(eq(products.id, id));
    await audit("product.delete", String(id), session.username);
    revalidateStorefront();
    return { ok: true, message: "商品及关联卡密已删除" };
  });
}

/* ===== 卡密 ===== */

export async function importCardsAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const productId = Number(formData.get("productId"));
    const raw = String(formData.get("content") ?? "");
    const lines = raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter((l) => l !== "");
    if (!Number.isInteger(productId) || lines.length === 0) {
      return { ok: false, message: "请选择商品并粘贴卡密（每行一条）" };
    }
    if (lines.length > 10_000) return { ok: false, message: "单次最多导入 10000 条" };
    const product = await db.select({ id: products.id }).from(products).where(eq(products.id, productId)).limit(1);
    if (!product[0]) return { ok: false, message: "商品不存在" };
    const inserted = await db
      .insert(cards)
      .values(lines.map((content) => ({ productId, content })))
      .onConflictDoNothing()
      .returning({ id: cards.id });
    const skipped = lines.length - inserted.length;
    await audit("cards.import", `${productId} x${inserted.length}`, session.username);
    revalidateStorefront();
    return {
      ok: true,
      message: skipped > 0 ? `已导入 ${inserted.length} 条，跳过重复 ${skipped} 条` : `已导入 ${inserted.length} 条`,
    };
  });
}

export async function deleteCardAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id)) return { ok: false, message: "参数错误" };
    // 只允许删除未售未锁的卡：reserved 属于待付订单，sold 是交付凭据
    const deleted = await db
      .delete(cards)
      .where(and(eq(cards.id, id), eq(cards.status, "available")))
      .returning({ id: cards.id });
    if (!deleted[0]) return { ok: false, message: "仅可删除可售状态的卡密，已锁定或已售出的不可删除" };
    await audit("cards.delete", String(id), session.username);
    revalidateStorefront();
    return { ok: true, message: "卡密已删除" };
  });
}

/* ===== 订单操作 ===== */

export async function closeOrderAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    return adminCloseOrder(String(formData.get("orderNo") ?? ""), session.username);
  });
}

export async function resolveReconcilingAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const orderNo = String(formData.get("orderNo") ?? "");
    const asPaid = String(formData.get("asPaid") ?? "") === "1";
    return asPaid
      ? resolveReconcilingAsPaid(orderNo, session.username)
      : resolveReconcilingAsNotCreated(orderNo, session.username);
  });
}

export async function retryDeliveryAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    return retryDelivery(String(formData.get("orderNo") ?? ""), session.username);
  });
}

/* ===== 支付网关（LitePay，单实例） ===== */

/** 凭据输入框语义：留空 = 保持原值；__CLEAR__ = 清除；其它 = 加密后替换 */
function nextSecret(submitted: string, existing: string): string {
  if (submitted === "__CLEAR__") return "";
  return submitted === "" ? existing : encryptSecret(submitted);
}

/**
 * 保存 LitePay 网关配置：地址、接口令牌、订单有效期、收银台币种与重选开关。
 * 令牌不回显：留空 = 保持原值，输入 __CLEAR__ 表示清除。
 */
export async function saveLitepayAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;

    const enabled = String(formData.get("litepayEnabled") ?? "") === "on";
    const apiBaseRaw = String(formData.get("litepayApiBase") ?? "").trim();
    const submitted = String(formData.get("litepayToken") ?? "").trim();
    const timeoutSeconds = Number(formData.get("litepayTimeout") ?? DEFAULT_TIMEOUT_SECONDS);
    const currencies = String(formData.get("litepayCurrencies") ?? "").trim().slice(0, 64);
    const reselect = String(formData.get("litepayReselect") ?? "") === "on";

    const apiBase = apiBaseRaw === "" ? "" : normalizeHttpUrl(apiBaseRaw);
    if (apiBase === null) return { ok: false, message: "网关地址不合法，仅支持 http:// 或 https:// 域名" };
    if (!Number.isInteger(timeoutSeconds) || timeoutSeconds < MIN_TIMEOUT_SECONDS || timeoutSeconds > MAX_TIMEOUT_SECONDS) {
      return { ok: false, message: `订单有效期需为 ${MIN_TIMEOUT_SECONDS}–${MAX_TIMEOUT_SECONDS} 秒之间的整数` };
    }
    const tokenEnc = nextSecret(submitted, (await getConfig()).litepayTokenEnc);
    if (enabled && (!apiBase || !tokenEnc)) {
      return { ok: false, message: "启用网关前请填写网关地址与接口令牌（已保存的令牌留空即可沿用）" };
    }

    await updateConfig({
      litepayEnabled: enabled,
      litepayApiBase: apiBase,
      litepayTokenEnc: tokenEnc,
      litepayTimeoutSeconds: timeoutSeconds,
      litepayCurrencies: currencies,
      litepayReselect: reselect,
    });
    await audit("settings.litepay", `enabled=${enabled}`, session.username);
    revalidateStorefront();
    return {
      ok: true,
      message: enabled ? "支付网关配置已保存并启用" : "支付网关配置已保存（当前停用，前台无法下单）",
    };
  });
}

/* ===== 站点设置 ===== */

export async function saveSiteSettingsAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const siteName = String(formData.get("siteName") ?? "").trim().slice(0, 50);
    const siteUrl = String(formData.get("siteUrl") ?? "").trim().replace(/\/+$/, "");
    const supportUrl = String(formData.get("supportUrl") ?? "").trim();
    const threshold = Number(formData.get("threshold") ?? 5);

    // 先全部校验，再一次性写入：不会出现「站点名已改、地址校验失败」的半保存状态
    if (siteUrl && !normalizeHttpUrl(siteUrl)) return { ok: false, message: "站点地址需为 http:// 或 https:// 开头的有效地址" };
    if (supportUrl && !normalizeHttpUrl(supportUrl)) return { ok: false, message: "客服地址需为 http:// 或 https:// 链接" };
    if (!Number.isInteger(threshold) || threshold < 0 || threshold > 100_000) {
      return { ok: false, message: "低库存提醒阈值需为非负整数" };
    }

    await updateConfig({ siteName, siteUrl, supportUrl, lowStockThreshold: threshold });
    await audit("settings.site", siteName || "site", session.username);
    revalidateStorefront();
    return { ok: true, message: "站点设置已保存" };
  });
}

/* ===== Turnstile 人机验证 ===== */

export async function saveTurnstileAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const enabled = String(formData.get("tsEnabled") ?? "") === "on";
    const siteKey = String(formData.get("tsSiteKey") ?? "").trim();
    const fallback = String(formData.get("tsFallback") ?? "") === "on";
    const secretEnc = nextSecret(
      String(formData.get("tsSecretKey") ?? "").trim(),
      (await getConfig()).turnstileSecretEnc
    );

    // 强制校验要求两把 Key 齐备；缺一会 widget 渲染不出来、下单被全量拒绝
    if (enabled && (siteKey === "" || secretEnc === "")) {
      return { ok: false, message: "启用人机验证需填写 Site Key 与 Secret Key" };
    }
    await updateConfig({
      turnstileEnabled: enabled,
      turnstileSiteKey: siteKey,
      turnstileSecretEnc: secretEnc,
      turnstileFallback: fallback,
    });
    await audit("settings.turnstile", `enabled=${enabled} fallback=${fallback}`, session.username);
    revalidateStorefront();
    return { ok: true, message: "人机验证设置已保存" };
  });
}

/* ===== SMTP ===== */

export async function saveSmtpAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const enabled = String(formData.get("smtpEnabled") ?? "") === "on";
    const host = String(formData.get("smtpHost") ?? "").trim();
    const port = Number(formData.get("smtpPort") ?? 465);
    const from = String(formData.get("smtpFrom") ?? "").trim();
    const user = String(formData.get("smtpUser") ?? "").trim();
    const pass = String(formData.get("smtpPass") ?? "").trim();
    if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: "SMTP 端口无效，需为 1–65535 之间的整数" };
    if (enabled) {
      if (!host) return { ok: false, message: "启用邮件通知需填写 SMTP 服务器地址" };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) && !/^[^@\s]+<[^@\s]+>$/.test(from)) {
        return { ok: false, message: "发件人邮箱格式无效" };
      }
    }
    await updateConfig({
      smtpEnabled: enabled,
      smtpHost: host,
      smtpPort: port,
      smtpSecure: String(formData.get("smtpSecure") ?? "") === "on",
      smtpUser: user,
      smtpPassEnc: nextSecret(pass, (await getConfig()).smtpPassEnc),
      smtpFrom: from,
    });
    await audit("settings.smtp", `enabled=${enabled}`, session.username);
    return { ok: true, message: "邮件设置已保存" };
  });
}

/* ===== 运营通知（Telegram） ===== */

export async function saveTelegramAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const enabled = String(formData.get("tgEnabled") ?? "") === "on";
    const chatId = String(formData.get("tgChatId") ?? "").trim();
    const tokenEnc = nextSecret(String(formData.get("tgToken") ?? "").trim(), (await getConfig()).telegramBotTokenEnc);
    if (chatId && !/^-?\d{1,20}$|^@[A-Za-z0-9_]{5,32}$/.test(chatId)) {
      return { ok: false, message: "Chat ID 应为数字（群组以 - 开头）或 @频道名" };
    }
    if (enabled && (!tokenEnc || !chatId)) return { ok: false, message: "启用通知需填写 Bot Token 与 Chat ID" };
    await updateConfig({ telegramEnabled: enabled, telegramBotTokenEnc: tokenEnc, telegramChatId: chatId });
    await audit("settings.telegram", `enabled=${enabled}`, session.username);
    return { ok: true, message: enabled ? "通知设置已保存，可发送测试消息验证" : "通知设置已保存（当前停用）" };
  });
}

export async function sendTestNotificationAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const r = await sendTestNotification();
    await audit("settings.telegram_test", r.ok ? "ok" : (r.error ?? ""), session.username);
    return r.ok ? { ok: true, message: "测试消息已发送，请在 Telegram 查看" } : { ok: false, message: `发送失败：${r.error}` };
  });
}

export async function sendTestEmailAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const to = String(formData.get("testTo") ?? "").trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) return { ok: false, message: "请输入有效的测试收件邮箱" };
    const result = await sendTestEmail(to);
    await audit("settings.smtp_test", to, session.username);
    return result.ok
      ? { ok: true, message: `测试邮件已发送至 ${to}` }
      : { ok: false, message: `发送失败：${result.error ?? "未知错误"}` };
  });
}

/* ===== 管理员凭据 ===== */

export async function changeCredentialsAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const currentPassword = String(formData.get("currentPassword") ?? "");
    const newUsername = String(formData.get("newUsername") ?? "").trim();
    const newPassword = String(formData.get("newPassword") ?? "");
    if (!currentPassword) return { ok: false, message: "请输入当前密码" };
    if (!newPassword && !newUsername) return { ok: false, message: "没有需要修改的内容" };
    if (newPassword && newPassword.length < 8) return { ok: false, message: "新密码至少 8 位" };

    const rows = await db.select().from(admins).where(eq(admins.username, session.username)).limit(1);
    const admin = rows[0];
    if (!admin || !verifyPassword(currentPassword, admin.passwordHash)) {
      return { ok: false, message: "当前密码不正确" };
    }
    await db
      .update(admins)
      .set({
        username: newUsername || admin.username,
        passwordHash: newPassword ? hashPassword(newPassword) : admin.passwordHash,
        updatedAt: new Date(),
      })
      .where(eq(admins.id, admin.id));
    await revokeAllSessions();
    await clearSessionCookie();
    await audit("admin.credentials", newUsername || admin.username, admin.username);
    return { ok: true, message: "凭据已更新，请重新登录" };
  });
}
