/**
 * 进程内滑动窗口限流（单实例部署，SQLite→PostgreSQL 仍为单写者单实例，无需 Redis）。
 *
 * 关键语义：限流命中时**返回失败让调用方重试**，绝不用于「确认收款」类决策——
 * 支付回调被限流必须让网关重试，否则会静默丢单。
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();

const SWEEP_INTERVAL_MS = 60_000;
const MAX_KEYS = 5_000;

function sweep(now: number, windowMs: number): void {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  for (const [k, b] of buckets) {
    b.hits = b.hits.filter((t) => now - t < windowMs);
    if (b.hits.length === 0) buckets.delete(k);
  }
  if (buckets.size > MAX_KEYS) buckets.clear();
}

export interface RateLimitResult {
  ok: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export function rateLimit(key: string, limit: number, windowMs: number): RateLimitResult {
  const now = Date.now();
  sweep(now, windowMs);
  const bucket = buckets.get(key) ?? { hits: [] };
  bucket.hits = bucket.hits.filter((t) => now - t < windowMs);
  if (bucket.hits.length >= limit) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    return {
      ok: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000)),
    };
  }
  bucket.hits.push(now);
  buckets.set(key, bucket);
  return { ok: true, remaining: limit - bucket.hits.length, retryAfterSeconds: 0 };
}

/** 客户端 IP（受信反代写入 XFF 最后一段；无代理时取连接地址） */
export function clientIpFromHeaders(headers: Headers): string {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const parts = xff.split(",").map((s) => s.trim()).filter(Boolean);
    const last = parts.at(-1);
    if (last) return last;
  }
  return headers.get("x-real-ip") ?? "unknown";
}
