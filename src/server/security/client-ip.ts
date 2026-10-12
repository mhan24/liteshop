import { headers } from "next/headers";

/**
 * 解析客户端真实 IP —— 用于限流与审计，**必须不可被客户端伪造**。
 *
 * 关键安全点：`X-Forwarded-For` 是**追加**语义。客户端可以自带一个伪造的
 * XFF，反向代理（Caddy/Nginx）会把真实来源追加到**末尾**。因此：
 * - 取第一段 = 取客户端提供的值 → 攻击者每次换一个假 IP 就能绕过 IP 限流
 * - 取最后一段 = 取离我们最近的可信代理写入的值（正确做法）
 *
 * 本项目固定为「Caddy → 应用」单层代理，故取最后一段；
 * 若将来在前面再加一层 CDN，需按层数调整 TRUSTED_PROXY_HOPS。
 */

/** 应用前面可信代理的层数（Caddy 一层） */
const TRUSTED_PROXY_HOPS = 1;

export function parseClientIp(
  forwardedFor: string | null | undefined,
  realIp?: string | null
): string {
  const raw = (forwardedFor ?? "").trim();
  if (raw !== "") {
    const parts = raw
      .split(",")
      .map((p) => p.trim())
      .filter((p) => p !== "");
    if (parts.length > 0) {
      // 从右往左跳过受信代理，取第一个非代理地址
      const idx = Math.max(0, parts.length - TRUSTED_PROXY_HOPS);
      return normalizeIp(parts[idx]);
    }
  }
  if (realIp && realIp.trim() !== "") return normalizeIp(realIp.trim());
  return "-";
}

/** 去掉 IPv6 映射前缀与端口，便于作为限流键 */
function normalizeIp(ip: string): string {
  let v = ip;
  if (v.startsWith("::ffff:")) v = v.slice(7);
  // IPv6 带端口形如 [::1]:1234
  const bracket = /^\[(.+)\]:\d+$/.exec(v);
  if (bracket) return bracket[1];
  return v;
}

/** 从当前请求头解析（Server Action / Route Handler 通用） */
export async function clientIpFromHeaders(): Promise<string> {
  const h = await headers();
  return parseClientIp(h.get("x-forwarded-for"), h.get("x-real-ip"));
}

/** 从给定 Headers 解析（Route Handler 中已持有 request 时使用） */
export function clientIpFromRequest(request: Request): string {
  return parseClientIp(
    request.headers.get("x-forwarded-for"),
    request.headers.get("x-real-ip")
  );
}
