import { randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";

/**
 * 查单密码：每笔订单独立随机密码，买家凭「邮箱 + 订单号 + 查单密码」查询订单。
 *
 * - 明文只在下单响应出现一次，库中仅存 Argon2id 哈希
 * - 字符集剔除易混淆字符（0/O/1/I/l），8 位 ≈ 40 bit 熵 + 限流足以抗暴力破解
 */

const ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
const PASSWORD_LENGTH = 8;

const ARGON2_OPTS = {
  memoryCost: 19_456, // 19 MiB（OWASP 推荐）
  timeCost: 2,
  parallelism: 1,
};

export function generateQueryPassword(): string {
  const bytes = randomBytes(PASSWORD_LENGTH);
  let out = "";
  for (const b of bytes) out += ALPHABET[b % ALPHABET.length];
  return out;
}

export async function hashQueryPassword(plain: string): Promise<string> {
  return hash(plain, ARGON2_OPTS);
}

/** 常量时间失败：无论输入格式如何都执行一次验证开销，避免按耗时枚举 */
export async function verifyQueryPassword(hashStr: string, plain: string): Promise<boolean> {
  if (!/^[2-9A-Z]{8}$/.test(plain)) {
    // 仍执行一次 dummy 校验，抹平时间差
    await verify(hashStr, "2AAAAAAA").catch(() => false);
    return false;
  }
  try {
    return await verify(hashStr, plain);
  } catch {
    return false;
  }
}
