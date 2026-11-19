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

let dummyHash: Promise<string> | null = null;
/** 订单不存在时用于抹平耗时的哈希（进程内惰性生成一次） */
function getDummyHash(): Promise<string> {
  return (dummyHash ??= hash("not-a-real-query-password", ARGON2_OPTS));
}

/**
 * 校验查单密码。hashStr 为 null（订单不存在/邮箱不符）时仍执行一次同等开销的
 * Argon2 校验再返回 false——否则「订单号 + 邮箱」是否匹配可以按响应耗时枚举。
 * 输入大小写与首尾空白不敏感。
 */
export async function verifyQueryPassword(hashStr: string | null, input: string): Promise<boolean> {
  const plain = input.trim().toUpperCase();
  const target = hashStr ?? (await getDummyHash());
  const wellFormed = /^[2-9A-Z]{8}$/.test(plain);
  try {
    const ok = await verify(target, wellFormed ? plain : "2AAAAAAA");
    return ok && wellFormed && hashStr !== null;
  } catch {
    return false;
  }
}
