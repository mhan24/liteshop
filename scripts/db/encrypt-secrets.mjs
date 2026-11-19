import { createCipheriv, createHash, randomBytes } from "node:crypto";

/**
 * 一次性数据迁移：把 settings 表里仍为明文的凭据加密（AES-256-GCM）。
 *
 * 与 src/lib/secret-box.ts 同一算法、同一密钥派生、同一密文格式（enc:v1:iv:tag:data），
 * 由 tests/integration/secret-settings.test.ts 保证两边互通。
 * 幂等：已是 enc:v1 密文或为空的值不处理。随容器启动的 migrate.mjs 执行。
 */

/** 需要加密存储的 settings 键 */
export const SECRET_SETTING_KEYS = ["smtp_pass", "turnstile_secret_key", "litepay_token_enc"];

const VERSION = "enc:v1";

export function encryptWith(authSecret, plain) {
  const key = createHash("sha256").update(`${authSecret}:payment-token`).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

/** @param {{ query: (sql: string, params?: unknown[]) => Promise<{ rows: any[] }> }} client */
export async function encryptPlaintextSecrets(client, authSecret) {
  if (!authSecret || authSecret.length < 32) throw new Error("[secrets] AUTH_SECRET 缺失或过短，无法加密凭据");
  const { rows } = await client.query("SELECT key, value FROM settings WHERE key = ANY($1)", [SECRET_SETTING_KEYS]);
  const migrated = [];
  for (const { key, value } of rows) {
    const plain = String(value ?? "").trim();
    if (plain === "" || plain.startsWith(VERSION)) continue;
    await client.query("UPDATE settings SET value = $1, updated_at = now() WHERE key = $2 AND value = $3", [
      encryptWith(authSecret, plain),
      key,
      value,
    ]);
    migrated.push(key);
  }
  return migrated;
}
