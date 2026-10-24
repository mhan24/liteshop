import { randomBytes } from "node:crypto";

/**
 * 订单号：LS + yyyymmddHHMMSS + 6 位随机（大写）。
 * 冲突概率极低；数据库 order_no 唯一索引兜底，冲突由调用方重试。
 */
export function generateOrderNo(now = new Date()): string {
  const ts = now
    .toISOString()
    .replace(/[-:TZ.]/g, "")
    .slice(0, 14);
  const rand = randomBytes(4).toString("hex").toUpperCase().slice(0, 6);
  return `LS${ts}${rand}`;
}

/** 渠道 key（webhook 路由用）：小写字母数字与短横线 */
export function normalizeChannelKey(raw: string): string | null {
  const k = raw.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9-]{1,31}$/.test(k) ? k : null;
}
