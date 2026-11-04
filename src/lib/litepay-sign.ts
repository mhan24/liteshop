import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * LitePay 接口签名（BEpusdt 通用签名，与网关 internal/sign 逐字对齐）：
 * 1. 剔除 signature 与空值（null / undefined / ""）
 * 2. 键 ASCII 升序
 * 3. k=v 用 & 拼接；布尔值按 true/false，数值取 JSON 原生十进制表示
 * 4. 末尾直接拼接接口令牌（无分隔符）
 * 5. MD5 → 小写 32 位十六进制
 *
 * 数值必须保持 JSON 里的十进制形态（不接受指数形式）：网关按 json.Number
 * 原文重新计算签名，任何改写都会导致验签失败。
 */

function jsonValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`签名参数含非法数值: ${v}`);
    return String(v);
  }
  return String(v ?? "");
}

export function litepaySignString(params: Record<string, unknown>, token: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = params[k];
    if (v === null || v === undefined || v === "") continue;
    parts.push(`${k}=${jsonValue(v)}`);
  }
  return parts.join("&") + token;
}

export function md5Hex(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

export function litepaySign(params: Record<string, unknown>, token: string): string {
  return md5Hex(litepaySignString(params, token));
}

/** 常量时间十六进制比较（防时序侧信道） */
export function safeEqualHex(a: string, b: string): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0) return false;
  const ba = Buffer.from(a.toLowerCase(), "utf8");
  const bb = Buffer.from(b.toLowerCase(), "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** 解析回调 JSON，必须为普通对象（防 null/数组导致 TypeError） */
export function parseJsonObject(
  raw: string
): { ok: true; value: Record<string, unknown> } | { ok: false; error: string } {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
      return { ok: false, error: "回调报文必须是 JSON 对象" };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, error: "JSON 解析失败" };
  }
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** HMAC-SHA256（hex；mock 回调签名） */
export function hmacHex(secret: string, text: string): string {
  return createHmac("sha256", secret).update(text, "utf8").digest("hex");
}
