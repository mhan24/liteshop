import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { cache } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { admins, auditLogs } from "@/db/schema";
import { env } from "@/lib/env";
import { rateLimit, resetRateLimit, clientIpFromHeaders } from "@/lib/rate-limit";
import { getAdminSessionVersion, invalidateConfig, updateConfig, updateConfigInTx } from "./settings";

/**
 * 管理员认证：独立 Session（HttpOnly Cookie），与买家体系完全隔离。
 *
 * - 凭据：env 引导的 admins 表（scrypt 哈希）；首次登录自动引导
 * - 会话：HMAC-SHA256 签名令牌（payload.username + version + exp），无服务端会话存储
 * - 全局登出：递增 settings.admin_session_version 使全部会话失效
 * - CSRF：无状态双重提交令牌（HMAC of session version），Server Action 内校验 Origin
 * - 登录限速：IP + 用户名 5 次失败锁 15 分钟
 */

const COOKIE_NAME = "ls_admin";
const SESSION_TTL_SECONDS = 8 * 3600;

/* ===== 密码（scrypt） ===== */

export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("密码至少 8 位");
  const salt = randomBytes(16);
  const N = 16384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(password, salt, 64, { N, r, p });
  return `scrypt:${N}:${r}:${p}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const m = /^scrypt:(\d+):(\d+):(\d+):([0-9a-f]+):([0-9a-f]+)$/.exec(stored);
  if (!m) return false;
  const [, n, r, p, saltHex, hashHex] = m;
  if (!n || !r || !p || !saltHex || !hashHex) return false;
  // Buffer.from(hex) 会静默截去半个字节；拒绝截断或弱于 256 位的摘要。
  if (saltHex.length % 2 || hashHex.length % 2 || hashHex.length < 64) return false;
  try {
    const expected = Buffer.from(hashHex, "hex");
    const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/* ===== 管理员账号 ===== */

export async function ensureAdminBootstrapped(): Promise<void> {
  const rows = await db.select({ id: admins.id }).from(admins).limit(1);
  if (rows.length > 0) return;
  if (!env.ADMIN_PASSWORD_HASH) return;
  await db
    .insert(admins)
    .values({ username: env.ADMIN_USER, passwordHash: env.ADMIN_PASSWORD_HASH })
    .onConflictDoNothing();
}

export interface AdminSession {
  username: string;
  version: number;
}

/** 校验用户名密码；成功返回会话信息，失败返回 null（含限速） */
export async function loginAdmin(username: string, password: string): Promise<AdminSession | null> {
  const ip = clientIpFromHeaders(await headers());
  if (!rateLimit(`login-ip:${ip}`, 60, 15 * 60_000).ok) return null;
  const key = `login:${ip}:${createHash("sha256").update(username).digest("hex")}`;
  const limited = rateLimit(key, 5, 15 * 60_000);
  if (!limited.ok) return null;

  await ensureAdminBootstrapped();
  // 先读版本，确保正在校验的旧密码最多签出旧版本会话。
  const version = await getAdminSessionVersion();
  const rows = await db.select().from(admins).where(eq(admins.username, username)).limit(1);
  const admin = rows[0];
  if (!admin) {
    // 抹平「用户不存在」与「密码错误」的时间差
    verifyPassword(password, `scrypt:16384:8:1:${"00".repeat(16)}:${"00".repeat(64)}`);
    return null;
  }
  if (!verifyPassword(password, admin.passwordHash)) return null;
  resetRateLimit(key);
  return { username: admin.username, version };
}

/* ===== 会话令牌 ===== */

interface SessionPayload {
  u: string;
  v: number;
  exp: number;
}

function sign(data: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(data).digest("base64url");
}

export async function createSessionCookie({ username, version }: AdminSession): Promise<void> {
  const payload: SessionPayload = {
    u: username,
    v: version,
    exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const token = `${body}.${sign(body)}`;
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export async function clearSessionCookie(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE_NAME);
}

/** 读取并校验当前管理员会话（页面/Action 共用） */
export async function getAdminSession(): Promise<AdminSession | null> {
  const store = await cookies();
  const raw = store.get(COOKIE_NAME)?.value;
  if (!raw) return null;
  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = raw.slice(0, dot);
  const sig = raw.slice(dot + 1);
  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let payload: SessionPayload;
  try {
    payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
  } catch {
    return null;
  }
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  const version = await getAdminSessionVersion();
  if (payload.v !== version) return null;
  return { username: payload.u, version };
}

export async function requireAdminSession(): Promise<AdminSession> {
  const session = await getAdminSession();
  if (!session) throw new Error("UNAUTHORIZED");
  return session;
}

/** RSC 布局与页面各自验证；同一次服务端渲染共用查询。 */
export const requireAdminPageSession = cache(async () => {
  const session = await getAdminSession();
  if (!session) redirect(`${env.ADMIN_PATH}/login`);
  return { ...session, csrf: csrfForVersion(session.version) };
});

/** 全局登出（改密后调用）：递增版本使所有会话失效 */
export async function revokeAllSessions(): Promise<void> {
  // 行锁内自增：并发改密不会丢失一次递增
  await updateConfig((c) => ({ adminSessionVersion: c.adminSessionVersion + 1 }));
}

export async function changeAdminCredentials(username: string, password: string, newUsername: string, newPassword: string): Promise<boolean> {
  const changed = await db.transaction(async (tx) => {
    const [admin] = await tx.select().from(admins).where(eq(admins.username, username)).for("update");
    if (!admin || !verifyPassword(password, admin.passwordHash)) return false;
    await tx.update(admins).set({
      username: newUsername || admin.username,
      passwordHash: newPassword ? hashPassword(newPassword) : admin.passwordHash,
      updatedAt: new Date(),
    }).where(eq(admins.id, admin.id));
    await updateConfigInTx(tx, (c) => ({ adminSessionVersion: c.adminSessionVersion + 1 }));
    return true;
  });
  if (changed) invalidateConfig();
  return changed;
}

/* ===== CSRF ===== */

/** 无状态 CSRF 令牌：HMAC(session_version)；页面渲染时嵌入，Action 提交时比对 */
function csrfForVersion(version: number): string {
  return sign(`csrf:${version}`);
}

export async function csrfToken(): Promise<string> {
  return csrfForVersion(await getAdminSessionVersion());
}

export async function assertCsrf(value: FormDataEntryValue | null): Promise<void> {
  // Origin 校验（防跨站提交）+ 令牌比对
  const h = await headers();
  const origin = h.get("origin");
  if (origin) {
    const allowed = new URL(process.env.SITE_URL ?? `http://localhost:${env.PORT}`).origin;
    if (origin !== allowed) throw new Error("CSRF 校验失败");
  }
  const expected = await csrfToken();
  const given = typeof value === "string" ? value : "";
  if (given.length !== expected.length) throw new Error("CSRF 校验失败");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff !== 0) throw new Error("CSRF 校验失败");
}

/* ===== 审计 ===== */

export async function audit(action: string, detail: string, actor: string): Promise<void> {
  const ip = clientIpFromHeaders(await headers());
  await db.insert(auditLogs).values({ actor, action, detail: detail.slice(0, 500), ip });
}
