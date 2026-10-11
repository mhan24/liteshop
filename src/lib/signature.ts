import { createHash, createHmac, timingSafeEqual } from "node:crypto";

/**
 * bepusdt 签名/验签（网关 app/utils EpusdtSign 源码级对齐，PLAN §5）：
 * 1. 全部字段剔除 signature，跳过空值（null / ""）
 * 2. 键 ASCII 字典序排序
 * 3. k=v 用 & 拼接，值经 Go fmt.Sprintf("%v") 等价格式化
 *    （bool → "true"/"false"；float64 → 最短表示，42 → "42"、42.5 → "42.5"；
 *      JS String() 与之一致）
 * 4. 去尾部 & 后直接拼接 API Token（无分隔符）
 * 5. MD5 → 小写十六进制
 */

export function goFormatValue(v: unknown): string {
  if (typeof v === "boolean") return v ? "true" : "false";
  if (typeof v === "number") {
    if (!Number.isFinite(v)) throw new Error(`签名参数含非法数值: ${v}`);
    return String(v);
  }
  return String(v ?? "");
}

export function epusdtSignString(params: Record<string, unknown>, token: string): string {
  const keys = Object.keys(params)
    .filter((k) => k !== "signature")
    .sort();
  const parts: string[] = [];
  for (const k of keys) {
    const v = params[k];
    if (v === null || v === undefined || v === "") continue;
    parts.push(`${k}=${goFormatValue(v)}`);
  }
  return parts.join("&") + token;
}

export function md5Hex(text: string): string {
  return createHash("md5").update(text, "utf8").digest("hex");
}

export function epusdtSign(params: Record<string, unknown>, token: string): string {
  return md5Hex(epusdtSignString(params, token));
}

/** 常量时间比较，防时序侧信道（PLAN §6-②） */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a.toLowerCase(), "utf8");
  const bb = Buffer.from(b.toLowerCase(), "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export function epusdtVerify(
  params: Record<string, unknown>,
  token: string
): boolean {
  const given = params["signature"];
  if (typeof given !== "string" || given === "") return false;
  return safeEqualHex(epusdtSign(params, token), given);
}

export function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** HMAC-SHA256（管理会话 cookie 签名等） */
export function hmacHex(secret: string, text: string): string {
  return createHmac("sha256", secret).update(text, "utf8").digest("hex");
}
