import { envConfig } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/session";
import { getSetting, setSetting } from "@/server/settings";

/** 管理员登录/登出/凭据修改（service 层；页面/Action 不得直连 DB） */

const SESSION_VERSION_KEY = "session_version";
const ADMIN_USERNAME_KEY = "admin_username";
const ADMIN_PASSWORD_HASH_KEY = "admin_password_hash";

/* 登录限速：内存滑动窗口（单实例部署足够；PLAN §6-③：5 次失败锁 15 分钟） */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; lockedUntil: number }>();

function attemptKey(ip: string, username: string): string {
  return `${ip}|${username}`;
}

/** 剩余锁定秒数；0 = 未锁定 */
export function lockedForSeconds(ip: string, username: string): number {
  const rec = attempts.get(attemptKey(ip, username));
  if (!rec) return 0;
  if (rec.lockedUntil > Date.now()) return Math.ceil((rec.lockedUntil - Date.now()) / 1000);
  return 0;
}

export function recordFailure(ip: string, username: string): void {
  const key = attemptKey(ip, username);
  const rec = attempts.get(key) ?? { count: 0, lockedUntil: 0 };
  rec.count += 1;
  if (rec.count >= MAX_FAILURES) {
    rec.lockedUntil = Date.now() + LOCKOUT_MS;
    rec.count = 0;
  }
  attempts.set(key, rec);
}

function clearFailures(ip: string, username: string): void {
  attempts.delete(attemptKey(ip, username));
}

function getSessionVersion(): number {
  const v = Number(getSetting(SESSION_VERSION_KEY) ?? "1");
  return Number.isFinite(v) && v > 0 ? v : 1;
}

/** 全局登出（改密/改用户名后调用）：版本号 +1 使全部已有会话失效 */
export function bumpSessionVersion(): void {
  setSetting(SESSION_VERSION_KEY, String(getSessionVersion() + 1));
}

/** 生效凭据：DB 设置优先，回落 .env（首次部署引导） */
export function getAdminCredentials(): { username: string; passwordHash: string | null } {
  const dbUser = getSetting(ADMIN_USERNAME_KEY)?.trim();
  const dbHash = getSetting(ADMIN_PASSWORD_HASH_KEY)?.trim();
  return {
    username: dbUser && dbUser !== "" ? dbUser : envConfig.adminUser,
    passwordHash: dbHash && dbHash !== "" ? dbHash : (envConfig.adminPasswordHash ?? null),
  };
}

export interface LoginResult {
  ok: boolean;
  message: string;
  /** 登录成功时返回待写入 Cookie 的会话 token */
  token?: string;
  maxAge?: number;
}

export async function login(ip: string, username: string, password: string): Promise<LoginResult> {
  const creds = getAdminCredentials();
  const okUser = username.trim() === creds.username;
  let okPassword = false;
  if (creds.passwordHash) {
    okPassword = verifyPassword(password, creds.passwordHash);
  } else if (!envConfig.isProd) {
    // 开发兜底：完全未配置哈希时允许 ADMIN_PASSWORD（默认 admin123）
    okPassword = password === envConfig.adminPasswordDev;
  }
  if (!okUser || !okPassword) {
    return { ok: false, message: "用户名或密码错误" };
  }
  clearFailures(ip, username);
  const token = await createSessionToken({ u: creds.username, v: getSessionVersion() });
  return { ok: true, message: "登录成功", token, maxAge: SESSION_TTL_SECONDS };
}

/** 校验请求携带的会话；版本不符视为失效（改密后全局登出） */
export async function currentSession(token: string | undefined | null) {
  const data = await verifySessionToken(token);
  if (!data) return null;
  if (data.v !== getSessionVersion()) return null;
  return data;
}

export interface ChangeCredentialsInput {
  currentPassword: string;
  newUsername?: string;
  newPassword?: string;
  /** 后台入口路径（仅路径段，如 my-panel） */
  newPath?: string;
}

export const RESERVED_ADMIN_PATHS = new Set([
  // "admin" 允许使用（默认入口/重置目标）；其余为公开前缀，禁止占用
  "api", "products", "orders", "pay", "static", "_next", "assets",
  "favicon.ico", "robots.txt", "sitemap.xml", "settings", "login", "logout",
]);

export interface ChangeCredentialsResult {
  ok: boolean;
  message: string;
  /** 任一修改成功即 true（会话已全部失效，需要重新登录） */
  reloginRequired?: boolean;
}

/** 修改管理员用户名/密码/后台入口路径：需验证当前密码；成功后全局登出 */
export function changeAdminCredentials(input: ChangeCredentialsInput): ChangeCredentialsResult {
  const creds = getAdminCredentials();
  const currentOk = creds.passwordHash
    ? verifyPassword(input.currentPassword, creds.passwordHash)
    : !envConfig.isProd && input.currentPassword === envConfig.adminPasswordDev;
  if (!currentOk) {
    return { ok: false, message: "当前密码不正确" };
  }

  let changed = 0;
  const notes: string[] = [];

  if (input.newUsername != null && input.newUsername.trim() !== "") {
    const u = input.newUsername.trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) {
      return { ok: false, message: "用户名需 3-32 位字母/数字/下划线/连字符" };
    }
    setSetting(ADMIN_USERNAME_KEY, u);
    changed += 1;
    notes.push("用户名已更新");
  }

  if (input.newPassword != null && input.newPassword !== "") {
    if (input.newPassword.length < 8 || input.newPassword.length > 128) {
      return { ok: false, message: "新密码需 8-128 位" };
    }
    setSetting(ADMIN_PASSWORD_HASH_KEY, hashPassword(input.newPassword));
    changed += 1;
    notes.push("密码已更新");
  }

  if (input.newPath != null && input.newPath.trim() !== "") {
    const p = input.newPath.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,32}$/.test(p) || RESERVED_ADMIN_PATHS.has(p)) {
      return { ok: false, message: "入口路径需 3-32 位小写字母/数字/连字符，且不能使用保留路径" };
    }
    setSetting("admin_path", p);
    changed += 1;
    notes.push(`后台入口已改为 /${p}`);
  }

  if (changed === 0) {
    return { ok: false, message: "没有需要修改的内容" };
  }
  // 凭据/入口变更 → 全部旧会话失效
  bumpSessionVersion();
  return {
    ok: true,
    message: `${notes.join("；")}。请使用新凭据重新登录`,
    reloginRequired: true,
  };
}
