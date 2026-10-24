import { randomBytes, scryptSync } from "node:crypto";

/** 生成 scrypt 哈希（scripts/admin/hash-password.ts 专用；与管理员认证格式一致） */
export function hashPassword(password: string): string {
  if (password.length < 8) throw new Error("密码至少 8 位");
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString("hex")}:${hash.toString("hex")}`;
}
