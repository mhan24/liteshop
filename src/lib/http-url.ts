/**
 * 仅接受 http/https 绝对地址；拒绝内嵌凭据、控制字符与内网元数据端点。
 * 用于任何会拼进 fetch() 或渲染为 <a href> 的外部 URL。
 */

const BLOCKED_HOSTS = new Set([
  "metadata.google.internal",
  "instance-data.ec2.internal",
  "100.100.100.200",
]);

export function normalizeHttpUrl(raw: string | undefined | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed || /[\u0000-\u001f\u007f]/.test(trimmed)) return null;
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;
  if (url.username || url.password) return null;
  const host = url.hostname.toLowerCase();
  if (BLOCKED_HOSTS.has(host)) return null;
  // 云元数据地址（169.254.169.254 等）
  if (/^169\.254\./.test(host)) return null;
  return url.toString();
}

/** 规范化为无路径的 origin（网关地址只填域名） */
export function normalizeOrigin(raw: string | undefined | null): string | null {
  const safe = normalizeHttpUrl(raw);
  if (!safe) return null;
  const url = new URL(safe);
  if (url.search || url.hash) return null;
  return url.origin;
}
