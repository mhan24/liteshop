/**
 * 站点时间统一为北京时间（Asia/Shanghai，UTC+8）。
 * 所有面向用户的日期展示都必须经过此助手，禁止 toISOString()（那是 UTC）。
 */

const TZ = "Asia/Shanghai";

const dateTimeFmt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * "2026-10-12 14:30"（北京时间）
 * 传入空值/非法日期返回 null，避免把 null 当 0 渲染成 1970-01-01。
 */
export function formatDateTime(d: Date | null | undefined): string | null {
  if (!d) return null;
  const ms = d instanceof Date ? d.getTime() : new Date(d).getTime();
  if (!Number.isFinite(ms) || ms <= 0) return null;
  return dateTimeFmt.format(new Date(ms)).replace(/\//g, "-");
}
