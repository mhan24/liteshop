import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { envConfig } from "@/lib/env";

/**
 * 交易所 API 凭据的**静态加密**。
 *
 * 交易所 API Key/Secret 与 bepusdt token 不同：它直接代表账户读取权限，
 * 一旦泄露，攻击者可读取账户全部流水与余额。因此不能像普通配置那样
 * 明文存进 payment_configs.config_json。
 *
 * 方案：AES-256-GCM，密钥由 `AUTH_SECRET` 派生（scrypt 之外的简单 KDF 即可，
 * 因为 AUTH_SECRET 本身是 32 字节随机值）。产出格式：
 *   `enc:v1:<iv_b64>:<tag_b64>:<ct_b64>`
 * 前缀带版本号，便于将来轮换算法。
 *
 * 注意：`AUTH_SECRET` 泄露 = 凭据泄露。这与应用会话密钥同源，
 * 因此它必须保持为强随机值（启动自检已强制其存在）。
 */

const PREFIX = "enc:v1:";

function deriveKey(): Buffer {
  const secret = envConfig.authSecret;
  if (!secret) {
    throw new Error("缺少 AUTH_SECRET，无法加密交易所凭据");
  }
  // 加固定上下文串，避免与其它用途（会话签名等）共用同一密钥流
  return createHash("sha256").update(`liteshop-exchange-credentials:${secret}`).digest();
}

export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(), iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${PREFIX}${iv.toString("base64")}:${tag.toString("base64")}:${ct.toString("base64")}`;
}

/** 解密；格式不符或认证失败返回 null（调用方据此判定凭据不可用） */
export function decryptSecret(value: string): string | null {
  if (!value.startsWith(PREFIX)) return null;
  const parts = value.slice(PREFIX.length).split(":");
  if (parts.length !== 3) return null;
  try {
    const [ivB64, tagB64, ctB64] = parts;
    const decipher = createDecipheriv("aes-256-gcm", deriveKey(), Buffer.from(ivB64, "base64"));
    decipher.setAuthTag(Buffer.from(tagB64, "base64"));
    const pt = Buffer.concat([decipher.update(Buffer.from(ctB64, "base64")), decipher.final()]);
    return pt.toString("utf8");
  } catch {
    // GCM 认证失败（密钥错误/被篡改）→ 视为不可用，绝不返回半解数据
    return null;
  }
}

/** 是否为密文（用于判断是否需要加密后再存） */
export function isEncrypted(value: string): boolean {
  return value.startsWith(PREFIX);
}
