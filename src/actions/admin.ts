"use server";

import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/db";
import { admins, categories, cards, paymentChannels, products } from "@/db/schema";
import { normalizeOrigin } from "@/lib/http-url";
import { encryptSecret } from "@/lib/secret-box";
import { normalizeChannelKey } from "@/lib/order-no";
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
  manualDeliver,
  resolveReconcilingAsNotCreated,
  resolveReconcilingAsPaid,
  retryDelivery,
} from "@/server/orders";
import { sendTestEmail } from "@/server/mail";
import {
  bumpAdminSessionVersion,
  getSetting,
  SETTING_KEYS,
  setSetting,
} from "@/server/settings";
import { SUPPORTED_CURRENCIES } from "@/server/settings";

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
  if (!session) return { ok: false, message: "用户名或密码错误（连续失败将锁定 15 分钟）" };
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
    if (!parsed.success) return { ok: false, message: "分类名称必填，slug 需为小写字母数字短横线" };
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
      return { ok: false, message: "分类创建失败（slug 可能已存在）" };
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
    return { ok: true, message: "分类已删除（商品保留，分类置空）" };
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
  priceMinor: z.coerce.number().int().min(0).max(10_000_000_000),
  deliveryType: z.enum(["auto", "manual"]),
  stockLimit: z.coerce.number().int().min(0).max(1_000_000).nullable(),
  status: z.enum(["on", "off"]),
  imageUrl: z.string().trim().max(2000).optional(),
  seoDescription: z.string().trim().max(300).optional(),
  categoryId: z.coerce.number().int().positive().nullable(),
});

function parseProductForm(formData: FormData): z.infer<typeof productSchema> | null {
  const stockRaw = String(formData.get("stockLimit") ?? "").trim();
  const catRaw = String(formData.get("categoryId") ?? "").trim();
  const imageRaw = String(formData.get("imageUrl") ?? "").trim();
  return productSchema.safeParse({
    name: formData.get("name"),
    slug: String(formData.get("slug") ?? "").trim(),
    description: String(formData.get("description") ?? ""),
    priceMinor: formData.get("priceMinor"),
    deliveryType: formData.get("deliveryType") === "manual" ? "manual" : "auto",
    stockLimit: stockRaw === "" ? null : Number(stockRaw),
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
    if (!input) return { ok: false, message: "商品字段不合法（名称 / slug / 价格必填）" };
    try {
      await db.insert(products).values({
        name: input.name,
        slug: input.slug,
        description: input.description,
        priceCents: input.priceMinor,
        deliveryType: input.deliveryType,
        stockLimit: input.stockLimit,
        status: input.status,
        imageUrl: input.imageUrl ?? null,
        seoDescription: input.seoDescription ?? null,
        categoryId: input.categoryId,
      });
    } catch {
      return { ok: false, message: "商品创建失败（slug 可能已存在）" };
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
    if (!input) return { ok: false, message: "商品字段不合法" };
    await db
      .update(products)
      .set({
        name: input.name,
        slug: input.slug,
        description: input.description,
        priceCents: input.priceMinor,
        deliveryType: input.deliveryType,
        stockLimit: input.stockLimit,
        status: input.status,
        imageUrl: input.imageUrl ?? null,
        seoDescription: input.seoDescription ?? null,
        categoryId: input.categoryId,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id));
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
    await db.delete(products).where(eq(products.id, id));
    await audit("product.delete", String(id), session.username);
    revalidateStorefront();
    return { ok: true, message: "商品及卡密已删除" };
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
    try {
      await db
        .insert(cards)
        .values(lines.map((content) => ({ productId, content })))
        .onConflictDoNothing();
    } catch {
      return { ok: false, message: "导入失败" };
    }
    await audit("cards.import", `${productId} x${lines.length}`, session.username);
    revalidateStorefront();
    return { ok: true, message: `已导入 ${lines.length} 条（重复内容自动跳过）` };
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
    await db.delete(cards).where(eq(cards.id, id));
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

export async function manualDeliverAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    return manualDeliver(
      String(formData.get("orderNo") ?? ""),
      String(formData.get("content") ?? ""),
      session.username
    );
  });
}

/* ===== 支付渠道（统一保存） ===== */

function channelFields(formData: FormData, prefix: string) {
  return {
    enabled: String(formData.get(`${prefix}.enabled`) ?? "") === "on",
    apiBase: String(formData.get(`${prefix}.apiBase`) ?? "").trim(),
    token: String(formData.get(`${prefix}.token`) ?? "").trim(),
    timeoutSeconds: Number(formData.get(`${prefix}.timeout`) ?? 600),
    currencies: String(formData.get(`${prefix}.currencies`) ?? "").trim(),
    displayName: String(formData.get(`${prefix}.displayName`) ?? "").trim().slice(0, 30),
    sortOrder: Number(formData.get(`${prefix}.sortOrder`) ?? 0),
    reselect: String(formData.get(`${prefix}.reselect`) ?? "") === "on",
  };
}

function normalizeTimeout(n: number): number {
  if (!Number.isFinite(n)) return 600;
  return Math.min(Math.max(Math.trunc(n), 180), 3600);
}

export interface ChannelSaveState extends AdminActionResult {
  detail?: Array<{ key: string; enabled: boolean }>;
}

/**
 * 统一保存全部支付渠道：一次提交、全部校验后落库；
 * 结果经 useActionState 内联渲染（POST 直返，无 GET 重定向）。
 */
export async function savePaymentChannelsAction(
  _prev: ChannelSaveState | null,
  formData: FormData
): Promise<ChannelSaveState> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;

    const rows = await db.select().from(paymentChannels);
    const detail: Array<{ key: string; enabled: boolean }> = [];
    for (const row of rows) {
      if (row.type === "mock") continue;
      const f = channelFields(formData, row.key);
      const apiOrigin = f.apiBase ? normalizeOrigin(f.apiBase) : null;
      if (f.apiBase && !apiOrigin) {
        return { ok: false, message: `${row.key} 网关地址不合法（仅接受 http/https 域名）` };
      }
      if (f.enabled && (!apiOrigin || !f.token)) {
        return {
          ok: false,
          message: `启用 ${row.key} 前请填写网关地址与对接令牌（令牌留空表示沿用已保存值）`,
        };
      }
      const existingToken = row.tokenEnc ? "set" : "";
      const tokenEnc =
        f.token === "__CLEAR__" ? null : f.token !== "" ? encryptSecret(f.token) : row.tokenEnc;
      if (f.enabled && !tokenEnc && existingToken !== "set") {
        return { ok: false, message: `启用 ${row.key} 前请填写对接令牌` };
      }
      await db
        .update(paymentChannels)
        .set({
          enabled: f.enabled,
          apiBase: apiOrigin,
          tokenEnc,
          timeoutSeconds: normalizeTimeout(f.timeoutSeconds),
          currencies: f.currencies || null,
          displayName: f.displayName || row.displayName,
          sortOrder: Number.isFinite(f.sortOrder) && f.sortOrder >= 0 ? Math.trunc(Math.min(f.sortOrder, 999)) : 0,
          reselect: f.reselect,
          updatedAt: new Date(),
        })
        .where(eq(paymentChannels.id, row.id));
      detail.push({ key: row.key, enabled: f.enabled });
      await audit("channel.save", `${row.key} enabled=${f.enabled}`, session.username);
    }
    revalidateStorefront();
    return {
      ok: true,
      message: `支付渠道配置已保存（${detail.map((d) => `${d.key}=${d.enabled ? "启用" : "停用"}`).join("，")}）`,
      detail,
    };
  });
}

export async function createChannelAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const key = normalizeChannelKey(String(formData.get("key") ?? ""));
    const displayName = String(formData.get("displayName") ?? "").trim().slice(0, 30);
    if (!key || !displayName) return { ok: false, message: "渠道标识（2-32 位小写字母数字短横线）与名称必填" };
    try {
      await db.insert(paymentChannels).values({
        key,
        type: "epusdt",
        displayName,
        timeoutSeconds: 600,
      });
    } catch {
      return { ok: false, message: "渠道创建失败（标识可能已存在）" };
    }
    await audit("channel.create", key, session.username);
    revalidatePath("/admin/payments");
    return { ok: true, message: "渠道已创建，请在下方填写网关地址与令牌" };
  });
}

export async function deleteChannelAction(
  _prev: AdminActionResult | null,
  formData: FormData
): Promise<AdminActionResult> {
  return withAdmin(async (session) => {
    const csrfErr = await checkCsrf(formData);
    if (csrfErr) return csrfErr;
    const id = Number(formData.get("id"));
    if (!Number.isInteger(id)) return { ok: false, message: "参数错误" };
    await db.delete(paymentChannels).where(eq(paymentChannels.id, id));
    await audit("channel.delete", String(id), session.username);
    revalidatePath("/admin/payments");
    return { ok: true, message: "渠道已删除" };
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
    const siteUrl = String(formData.get("siteUrl") ?? "").trim();
    const currency = String(formData.get("currency") ?? "USD").toUpperCase();
    const supportUrl = String(formData.get("supportUrl") ?? "").trim();
    const threshold = Number(formData.get("threshold") ?? 5);

    if (siteName) await setSetting(SETTING_KEYS.siteName, siteName);
    if (siteUrl && !/^https?:\/\//.test(siteUrl)) {
      return { ok: false, message: "站点地址需以 http:// 或 https:// 开头" };
    }
    if (siteUrl) await setSetting(SETTING_KEYS.siteUrl, siteUrl.replace(/\/+$/, ""));
    if (!(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
      return { ok: false, message: "币种不支持" };
    }
    await setSetting(SETTING_KEYS.currency, currency);
    if (supportUrl) {
      if (!/^https?:\/\//.test(supportUrl)) return { ok: false, message: "客服地址需为 http/https 链接" };
      await setSetting(SETTING_KEYS.supportUrl, supportUrl);
    } else {
      await setSetting(SETTING_KEYS.supportUrl, "");
    }
    if (Number.isFinite(threshold) && threshold >= 0) {
      await setSetting(SETTING_KEYS.cardLowStockThreshold, String(Math.trunc(threshold)));
    }
    await audit("settings.site", `currency=${currency}`, session.username);
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
    const submitted = String(formData.get("tsSecretKey") ?? "").trim();

    // Secret Key 不回显：留空 = 保持原值，输入 __CLEAR__ 表示清除
    // （历史缺陷：回显会让密钥出现在页面源码中）
    const existing = (await getSetting(SETTING_KEYS.turnstileSecretKey))?.trim() ?? "";
    const secretKey = submitted === "__CLEAR__" ? "" : submitted === "" ? existing : submitted;

    // 强制校验要求两把 Key 齐备；缺一会 widget 渲染不出来、下单被全量拒绝
    if (enabled && (siteKey === "" || secretKey === "")) {
      return { ok: false, message: "启用人机验证需填写 Site Key 与 Secret Key" };
    }
    const fallback = String(formData.get("tsFallback") ?? "") === "on";
    await setSetting(SETTING_KEYS.turnstileEnabled, enabled ? "1" : "0");
    await setSetting(SETTING_KEYS.turnstileSiteKey, siteKey);
    await setSetting(SETTING_KEYS.turnstileSecretKey, secretKey);
    await setSetting(SETTING_KEYS.turnstileFallbackEnabled, fallback ? "1" : "0");
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
    if (enabled) {
      if (!host) return { ok: false, message: "启用邮件通知需填写 SMTP 服务器地址" };
      if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, message: "端口非法" };
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(from) && !/^[^@\s]+<[^@\s]+>$/.test(from)) {
        return { ok: false, message: "发件人格式无效" };
      }
    }
    await setSetting(SETTING_KEYS.smtpEnabled, enabled ? "1" : "0");
    await setSetting(SETTING_KEYS.smtpHost, host);
    await setSetting(SETTING_KEYS.smtpPort, String(port));
    await setSetting(SETTING_KEYS.smtpSecure, String(formData.get("smtpSecure") ?? "") === "on" ? "1" : "0");
    await setSetting(SETTING_KEYS.smtpUser, user);
    // 留空 = 保持原密码；__CLEAR__ = 清除
    if (pass === "__CLEAR__") await setSetting(SETTING_KEYS.smtpPass, "");
    else if (pass !== "") await setSetting(SETTING_KEYS.smtpPass, pass);
    await setSetting(SETTING_KEYS.smtpFrom, from);
    await audit("settings.smtp", `enabled=${enabled}`, session.username);
    return { ok: true, message: "邮件设置已保存" };
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
    await bumpAdminSessionVersion();
    await clearSessionCookie();
    await audit("admin.credentials", newUsername || admin.username, admin.username);
    return { ok: true, message: "凭据已更新，请重新登录" };
  });
}
