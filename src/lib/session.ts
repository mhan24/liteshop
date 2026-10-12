/**
 * 管理会话（Edge 兼容：仅用 WebCrypto，供 middleware 与 server 共用）。
 * Token = base64url(payload) + "." + hex(HMAC-SHA256)；HttpOnly Cookie 承载。
 */

export const ADMIN_COOKIE = "liteshop_admin";
export const SESSION_TTL_SECONDS = 8 * 60 * 60; // 8h（PLAN §6-③）

export interface SessionData {
  u: string;
  /** 过期时间（epoch 秒） */
  exp: number;
  /** 会话版本（settings.session_version），改密后 +1 全局登出 */
  v: number;
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmac(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return toBase64Url(new Uint8Array(sig));
}

/**
 * CSRF token：与「会话版本」绑定（HMAC(secret, "csrf:v2:" + v)）。
 *
 * 历史缺陷：token 是部署级常量，一旦泄露（截图/日志/分享链接）对**所有**会话
 * 长期有效，且无法轮换。绑定会话版本后，改密/改入口使会话版本 +1 时，
 * 旧 token 立即失效；同时 token 本身不再能跨部署复用。
 *
 * 仍然配合 Origin 校验（见 assertCsrf），形成双层防护。
 */
export async function csrfToken(sessionVersion?: number): Promise<string> {
  const v = sessionVersion ?? 1;
  return hmac(authSecret(), `csrf:liteshop:v2:${v}`);
}

/** 从请求头解析 Origin / Referer，用于同源校验 */
export async function assertSameOrigin(headers: Headers): Promise<void> {
  const origin = headers.get("origin");
  const host = headers.get("host");
  if (!origin) {
    // 无 Origin：多为同源表单提交被浏览器省略，交由 CSRF token 校验兜底
    return;
  }
  let originHost: string;
  try {
    originHost = new URL(origin).host;
  } catch {
    throw new Error("CSRF 校验失败：Origin 非法");
  }
  if (!host || originHost !== host) {
    throw new Error("CSRF 校验失败：跨站来源");
  }
}

export async function assertCsrf(
  value: FormDataEntryValue | null,
  sessionVersion?: number,
  headers?: Headers
): Promise<void> {
  if (headers) await assertSameOrigin(headers);
  const expected = await csrfToken(sessionVersion);
  const given = typeof value === "string" ? value : "";
  if (given.length !== expected.length) throw new Error("CSRF 校验失败");
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ given.charCodeAt(i);
  if (diff !== 0) throw new Error("CSRF 校验失败");
}

/** AUTH_SECRET 需静态引用以便 edge 环境内联 */
export function authSecret(): string {
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("生产环境必须设置 AUTH_SECRET");
    }
    return "dev-only-insecure-secret";
  }
  return secret;
}

export async function createSessionToken(
  data: Omit<SessionData, "exp">,
  secret: string = authSecret()
): Promise<string> {
  const payload: SessionData = { ...data, exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS };
  const body = toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${await hmac(secret, body)}`;
}

export async function verifySessionToken(
  token: string | undefined | null,
  secret: string = authSecret()
): Promise<SessionData | null> {
  if (!token) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = await hmac(secret, body);
  if (sig.length !== expected.length) return null;
  // 常量时间比较
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff !== 0) return null;
  try {
    const data = JSON.parse(new TextDecoder().decode(fromBase64Url(body))) as SessionData;
    if (typeof data.exp !== "number" || data.exp < Date.now() / 1000) return null;
    return data;
  } catch {
    return null;
  }
}
