import { eq } from "drizzle-orm";
import { envConfig } from "@/lib/env";
import { hashPassword, verifyPassword } from "@/lib/password";
import { createSessionToken, SESSION_TTL_SECONDS, verifySessionToken } from "@/lib/session";
import { getSetting, setSetting } from "@/server/settings";
import { db } from "@/db";
import { rateLimitCounters, settings } from "@/db/schema";

/** 管理员登录/登出/凭据修改（service 层；页面/Action 不得直连 DB） */

const SESSION_VERSION_KEY = "session_version";
const ADMIN_USERNAME_KEY = "admin_username";
const ADMIN_PASSWORD_HASH_KEY = "admin_password_hash";

/**
 * 登录限速：内存滑动窗口（单实例部署足够；PLAN §6-③：5 次失败锁 15 分钟）。
 *
 * 两个维度都要限：
 * - **IP + 用户名**：针对固定目标的爆破（5 次锁 15 分钟）
 * - **仅 IP**：防止轮换用户名绕过 —— 攻击者用不同用户名时，
 *   每个新用户名都会创建一条件独立记录，既绕过了按用户名的锁定，
 *   又能无限扩张键空间（内存耗尽）。
 *
 * 记录带 TTL 与容量上限，避免内存无界增长。
 */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60 * 1000;

/** 仅按 IP 的限速：同一 IP 15 分钟内最多 20 次失败（跨用户名累计） */
const IP_MAX_FAILURES = 20;

/** 记录保留时长：超过后视为过期可回收 */
const RECORD_TTL_MS = 60 * 60 * 1000;
/** 容量上限：超出时优先淘汰已过期、再淘汰最旧记录，防止内存被撑爆 */
const MAX_RECORDS = 5000;

interface AttemptRecord {
  count: number;
  lockedUntil: number;
  /** 最近更新时间，用于 TTL 回收与容量淘汰 */
  updatedAt: number;
}

const attempts = new Map<string, AttemptRecord>();

function attemptKey(ip: string, username: string): string {
  return `${ip}|${username}`;
}

/**
 * 回收过期记录。
 *
 * 每次记录失败都全量遍历会带来 O(n) 开销，因此按时间节流：
 * 至多每 SWEEP_INTERVAL_MS 扫一次（内存里最多多留一会儿过期项，无功能影响）。
 */
const SWEEP_INTERVAL_MS = 60_000;
let lastSweepAt = 0;

function sweepExpired(now = Date.now()): void {
  if (now - lastSweepAt < SWEEP_INTERVAL_MS) return;
  lastSweepAt = now;
  for (const [k, v] of attempts) {
    if (now - v.updatedAt > RECORD_TTL_MS && v.lockedUntil <= now) attempts.delete(k);
  }
}

/**
 * 容量保护：超出上限时淘汰最旧记录。
 *
 * 关键：**不能每次插入都排序**（O(n log n)）。攻击者高频失败时，
 * 每请求一次全量排序本身就是一种 CPU 放大。改为按批淘汰：
 * 仅在超过上限一定比例时清理一次，且一次性削到上限，
 * 把摊销成本降到 O(1)。
 */
const EVICT_BATCH_RATIO = 1.25; // 超出上限 25% 才触发一次批量淘汰

function enforceCapacity(): void {
  if (attempts.size <= MAX_RECORDS * EVICT_BATCH_RATIO) return;
  const sorted = [...attempts.entries()].sort((a, b) => a[1].updatedAt - b[1].updatedAt);
  const toRemove = attempts.size - MAX_RECORDS;
  for (let i = 0; i < toRemove; i++) attempts.delete(sorted[i][0]);
}

/** 锁定计数持久化：使锁定在进程重启与多副本下保持一致 */
function loadAttempt(key: string, now: number): AttemptRecord | null {
  try {
    const row = db
      .select({ count: rateLimitCounters.count, resetAt: rateLimitCounters.resetAt })
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.bucketKey, `login:${key}`))
      .get();
    if (!row) return null;
    if (row.resetAt.getTime() <= now) return null;
    // 持久化只存 count 与窗口结束时间；lockedUntil 即窗口结束时间
    return { count: row.count, lockedUntil: row.resetAt.getTime(), updatedAt: row.resetAt.getTime() };
  } catch {
    return null;
  }
}

function persistAttempt(key: string, rec: AttemptRecord): void {
  try {
    db.insert(rateLimitCounters)
      .values({
        bucketKey: `login:${key}`,
        count: rec.count,
        resetAt: new Date(Math.max(rec.lockedUntil, rec.updatedAt + LOCKOUT_MS)),
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: rateLimitCounters.bucketKey,
        set: {
          count: rec.count,
          resetAt: new Date(Math.max(rec.lockedUntil, rec.updatedAt + LOCKOUT_MS)),
          updatedAt: new Date(),
        },
      })
      .run();
  } catch {
    // 忽略：内存计数仍生效
  }
}

/** 取记录：内存优先，缺失回源 DB（重启后仍能恢复锁定状态） */
function getAttempt(key: string, now: number): AttemptRecord | undefined {
  const mem = attempts.get(key);
  if (mem && mem.lockedUntil > now) return mem;
  const persisted = loadAttempt(key, now);
  if (persisted) {
    attempts.set(key, persisted);
    return persisted;
  }
  return mem;
}

/** 剩余锁定秒数；0 = 未锁定（取用户名维度与 IP 维度中较长者） */
export function lockedForSeconds(ip: string, username: string): number {
  const now = Date.now();
  sweepExpired(now);
  const rec = getAttempt(attemptKey(ip, username), now);
  const userLock = rec && rec.lockedUntil > now ? rec.lockedUntil : 0;
  const ipRec = getAttempt(`ip:${ip}`, now);
  const ipLock = ipRec && ipRec.lockedUntil > now ? ipRec.lockedUntil : 0;
  const until = Math.max(userLock, ipLock);
  return until > now ? Math.ceil((until - now) / 1000) : 0;
}

export function recordFailure(ip: string, username: string): void {
  const now = Date.now();
  sweepExpired(now);

  // 维度 1：IP + 用户名
  const key = attemptKey(ip, username);
  const prev = getAttempt(key, now);
  const rec: AttemptRecord = prev ?? { count: 0, lockedUntil: 0, updatedAt: now };
  rec.count += 1;
  rec.updatedAt = now;
  if (rec.count >= MAX_FAILURES) {
    rec.lockedUntil = now + LOCKOUT_MS;
    rec.count = 0;
  }
  attempts.set(key, rec);
  persistAttempt(key, rec);

  // 维度 2：仅 IP（跨用户名累计，防轮换绕过）
  const ipKey = `ip:${ip}`;
  const ipRec = attempts.get(ipKey) ?? { count: 0, lockedUntil: 0, updatedAt: now };
  ipRec.count += 1;
  ipRec.updatedAt = now;
  if (ipRec.count >= IP_MAX_FAILURES) {
    ipRec.lockedUntil = now + LOCKOUT_MS;
    ipRec.count = 0;
  }
  attempts.set(ipKey, ipRec);
  persistAttempt(ipKey, ipRec);

  enforceCapacity();
}

function clearFailures(ip: string, username: string): void {
  const keys = [attemptKey(ip, username), `ip:${ip}`];
  for (const k of keys) attempts.delete(k);
  try {
    for (const k of keys) {
      db.delete(rateLimitCounters).where(eq(rateLimitCounters.bucketKey, `login:${k}`)).run();
    }
  } catch {
    // 忽略
  }
}

/** 仅供测试：读取当前记录数 */
export function _attemptRecordsSize(): number {
  return attempts.size;
}

export function getSessionVersion(): number {
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
    : false;
  if (!currentOk) {
    return { ok: false, message: "当前密码不正确" };
  }

  // ── 阶段 1：先**全部校验**，不写库 ────────────────────────────────────────
  // 历史缺陷：逐项「校验→写入」，若用户名已写成功而密码校验失败，
  // 会返回失败但配置已被部分修改（管理员看到失败却已生效，容易锁死自己）。
  const pending: { key: string; value: string; note: string }[] = [];
  const notes: string[] = [];

  if (input.newUsername != null && input.newUsername.trim() !== "") {
    const u = input.newUsername.trim();
    if (!/^[a-zA-Z0-9_-]{3,32}$/.test(u)) {
      return { ok: false, message: "用户名需 3-32 位字母/数字/下划线/连字符" };
    }
    pending.push({ key: ADMIN_USERNAME_KEY, value: u, note: "用户名已更新" });
  }

  if (input.newPassword != null && input.newPassword !== "") {
    if (input.newPassword.length < 8 || input.newPassword.length > 128) {
      return { ok: false, message: "新密码需 8-128 位" };
    }
    // 哈希计算放在事务外（scrypt 较慢，不应占用写事务）
    pending.push({
      key: ADMIN_PASSWORD_HASH_KEY,
      value: hashPassword(input.newPassword),
      note: "密码已更新",
    });
  }

  if (input.newPath != null && input.newPath.trim() !== "") {
    const p = input.newPath.trim().toLowerCase();
    if (!/^[a-z0-9-]{3,32}$/.test(p) || RESERVED_ADMIN_PATHS.has(p)) {
      return { ok: false, message: "入口路径需 3-32 位小写字母/数字/连字符，且不能使用保留路径" };
    }
    pending.push({ key: "admin_path", value: p, note: `后台入口已改为 /${p}` });
  }

  if (pending.length === 0) {
    return { ok: false, message: "没有需要修改的内容" };
  }

  // ── 阶段 2：全部校验通过后，在一个事务内提交 ─────────────────────────────
  // 任一项失败则整体回滚，不会出现"改了一半"的状态。
  db.transaction(
    (tx) => {
      for (const item of pending) {
        tx.insert(settings)
          .values({ key: item.key, value: item.value, updatedAt: new Date() })
          .onConflictDoUpdate({
            target: settings.key,
            set: { value: item.value, updatedAt: new Date() },
          })
          .run();
        notes.push(item.note);
      }
    },
    { behavior: "immediate" }
  );

  // 凭据/入口变更 → 全部旧会话失效
  bumpSessionVersion();
  return {
    ok: true,
    message: `${notes.join("；")}。请使用新凭据重新登录`,
    reloginRequired: true,
  };
}
