import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "./env";

/**
 * settings 表凭据静态加密（AES-256-GCM）：LitePay 令牌、SMTP 密码、Turnstile Secret。
 *
 * 密钥派生自 AUTH_SECRET（sha256 分域；域标签沿用 "payment-token"，改动会让已存密文失效），
 * 数据库泄露不等于凭据泄露。密文格式：enc:v1:<iv-b64>:<tag-b64>:<data-b64>
 * 存量明文由 scripts/db/encrypt-secrets.mjs 在启动迁移时一次性转换（算法与此处一致）。
 */

const VERSION = "enc:v1";

function key(): Buffer {
  return createHash("sha256").update(`${env.AUTH_SECRET}:payment-token`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${VERSION}:${iv.toString("base64")}:${tag.toString("base64")}:${data.toString("base64")}`;
}

export function decryptSecret(enc: string): string | null {
  if (!enc.startsWith(VERSION)) return null;
  const [, , ivB64, tagB64, dataB64] = enc.split(":");
  if (!ivB64 || !tagB64 || !dataB64) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(dataB64, "base64")), decipher.final()]).toString(
      "utf8"
    );
  } catch {
    return null;
  }
}

/** 读取凭据：未设置、非密文或解不开（AUTH_SECRET 变更）一律返回空串 */
export function revealSecret(enc: string | null | undefined): string {
  return isEncryptedSecret(enc) ? (decryptSecret(enc!) ?? "") : "";
}

/** 是否已保存凭据（后台展示「已设置」用；明文永不回显） */
export function isEncryptedSecret(enc: string | null | undefined): boolean {
  return typeof enc === "string" && enc.startsWith(VERSION);
}
