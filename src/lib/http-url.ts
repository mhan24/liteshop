/** 链接边界统一校验；不把脚本协议、凭据或浏览器特殊规范化输入传给导航。 */
export function normalizeHttpUrl(value: string, base?: string): string | null {
  const raw = value.trim();
  if (!raw || /[\u0000-\u0020\u007f\\]/.test(raw)) return null;
  try {
    const url = base ? new URL(raw, base) : new URL(raw);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    return url.toString();
  } catch { return null; }
}
