import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * scrypt 口令哈希（PLAN §6-③：.env 存 ADMIN_PASSWORD_HASH，不落明文比对）。
 * 格式：scrypt:N:r:p:salt:hash（hex 值不含冒号）。
 * 注意：不要用 `$` 作分隔符——Docker Compose 加载 env_file 时会插值 `$var` 导致哈希损坏。
 */

const N = 16384;
const R = 8;
const P = 1;

export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N, r: R, p: P });
  return `scrypt:${N}:${R}:${P}:${salt.toString("hex")}:${hash.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  // 兼容历史 `$` 分隔格式
  const parts = stored.includes(":") ? stored.split(":") : stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [, n, r, p, saltHex, hashHex] = parts;
  const expected = Buffer.from(hashHex, "hex");
  let actual: Buffer;
  try {
    actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length, {
      N: Number(n),
      r: Number(r),
      p: Number(p),
    });
  } catch {
    return false;
  }
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}
