import { createHmac } from "node:crypto";

/**
 * 交易所 API 请求签名 —— **纯函数**，便于单测与复用。
 *
 * 两家规范不同，不能混用：
 * - 币安：`HMAC-SHA256(secret, queryString)` → **hex**，结果作为 query 的
 *   `signature` 参数（请求头另带 `X-MBX-APIKEY`）
 * - 欧易：`HMAC-SHA256(secret, timestamp + method + requestPath)` → **base64**，
 *   放在 `OK-ACCESS-SIGN` 头；`requestPath` **包含 query string**
 */

/** 币安签名：对 query string 原文做 HMAC-SHA256，输出 hex */
export function binanceSign(secret: string, queryString: string): string {
  return createHmac("sha256", secret).update(queryString, "utf8").digest("hex");
}

/**
 * 拼币安 query string。
 * 键按字典序升序（便于稳定复现签名原文），值做 URL 编码。
 * 注意：签名必须对**最终发送的这段字符串**计算，顺序本身不要求排序，
 * 但排序能保证「构造」与「发送」两处完全一致。
 */
export function buildBinanceQuery(params: Record<string, string | number>): string {
  return Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join("&");
}

/** 欧易签名：timestamp + method + requestPath（含 query），输出 base64 */
export function okxSign(
  secret: string,
  timestamp: string,
  method: string,
  requestPath: string
): string {
  return createHmac("sha256", secret)
    .update(`${timestamp}${method.toUpperCase()}${requestPath}`, "utf8")
    .digest("base64");
}

/** 拼欧易 requestPath（路径 + query），顺序即发送顺序 */
export function buildOkxRequestPath(
  path: string,
  params: Record<string, string | number>
): string {
  const qs = Object.keys(params)
    .sort()
    .map((k) => `${k}=${encodeURIComponent(String(params[k]))}`)
    .join("&");
  return qs ? `${path}?${qs}` : path;
}
