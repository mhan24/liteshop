import { and, eq, gte, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";

/**
 * 下单与回调限流。
 *
 * 威胁模型：Turnstile 关闭时（或未配置时），任何脚本都能批量 POST 下单：
 * - 每单会**锁定卡密**（auto 型 reserved）或**扣减库存**（manual 型），
 *   攻击者可以把在售库存全部占满，正常买家无法购买（拒绝服务型攻击）。
 * - 未支付订单只在超时后释放（默认 900 秒），期间持续占用。
 *
 * 因此需要多维限制，单靠 IP 不够（攻击者可换 IP），单靠邮箱也不够
 * （可换邮箱），必须叠加「活跃待支付订单总量」这一全局兜底。
 */

/** 内存滑动窗口（单实例部署；与 lib/flash-store 同样的取舍） */
const buckets = new Map<string, { count: number; resetAt: number }>();

export interface RateLimitRule {
  /** 窗口时长（毫秒） */
  windowMs: number;
  /** 窗口内允许的最大次数 */
  max: number;
}

export const ORDER_RATE_RULES = {
  /** 同一 IP：1 分钟最多 5 单 */
  perIp: { windowMs: 60_000, max: 5 } as RateLimitRule,
  /** 同一邮箱：10 分钟最多 3 单 */
  perEmail: { windowMs: 600_000, max: 3 } as RateLimitRule,
} as const;

/** 全局同时存在的待支付订单上限（防换 IP/邮箱绕过） */
export const MAX_ACTIVE_PENDING_ORDERS = 200;
/** 同一邮箱同时存在的待支付订单上限 */
export const MAX_ACTIVE_PENDING_PER_EMAIL = 5;

export interface RateLimitResult {
  ok: boolean;
  message?: string;
  retryAfterSeconds?: number;
}

/** 消费一次配额；超限返回 ok=false */
/**
 * 单次调用内触发清理的最小间隔（毫秒）。
 * 清理是 O(n) 遍历，不能每次请求都做（否则限流本身成了 CPU 放大）。
 */
const SWEEP_THROTTLE_MS = 60_000;
/** 容量上限：超出后批量淘汰最旧的记录，防止内存无界增长 */
const MAX_BUCKETS = 20_000;

export function consume(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();

  // 节流式清理 + 容量保护（曾缺失：sweepRateBuckets 已导出但无人调用，
  // Map 也无容量上限，导致过期记录长期滞留内存）。
  if (now - lastSweepAt >= SWEEP_THROTTLE_MS) {
    lastSweepAt = now;
    sweepRateBuckets(now);
  }
  if (buckets.size > MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < buckets.size - MAX_BUCKETS; i++) buckets.delete(sorted[i][0]);
  }

  const rec = buckets.get(key);

  if (!rec || rec.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + rule.windowMs });
    return { ok: true };
  }
  if (rec.count >= rule.max) {
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((rec.resetAt - now) / 1000),
      message: `操作过于频繁，请 ${Math.ceil((rec.resetAt - now) / 1000)} 秒后再试`,
    };
  }
  rec.count += 1;
  return { ok: true };
}

/** 定期清理过期桶，避免内存无界增长 */
export function sweepRateBuckets(now = Date.now()): number {
  let removed = 0;
  for (const [k, v] of buckets) {
    if (v.resetAt <= now) {
      buckets.delete(k);
      removed += 1;
    }
  }
  return removed;
}

/** 仅供测试：重置内存计数 */
let lastSweepAt = 0;

/** 供测试：读取当前记录数 */
export function _rateBucketSize(): number {
  return buckets.size;
}

export function resetRateBuckets(): void {
  buckets.clear();
  lastSweepAt = 0;
}

/**
 * 下单前的综合限流检查。
 * 顺序：IP 频率 → 邮箱频率 → 邮箱活跃订单数 → 全局活跃订单数。
 */
export function checkOrderRateLimit(ip: string, email: string): RateLimitResult {
  const ipRule = consume(`order:ip:${ip}`, ORDER_RATE_RULES.perIp);
  if (!ipRule.ok) return ipRule;

  const mailKey = email.trim().toLowerCase();
  const mailRule = consume(`order:mail:${mailKey}`, ORDER_RATE_RULES.perEmail);
  if (!mailRule.ok) return mailRule;

  // 该邮箱未支付的订单过多 → 疑似刷单
  const perEmail = db
    .select({ c: sql<number>`count(*)` })
    .from(orders)
    .where(and(eq(orders.status, "pending"), sql`lower(${orders.email}) = ${mailKey}`))
    .get()?.c ?? 0;
  if (perEmail >= MAX_ACTIVE_PENDING_PER_EMAIL) {
    return {
      ok: false,
      message: "你有多笔待支付订单，请先完成支付或取消后再下单",
    };
  }

  // 全局兜底：防止攻击者疯狂换 IP/邮箱占满库存
  const active = db
    .select({ c: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "pending"))
    .get()?.c ?? 0;
  if (active >= MAX_ACTIVE_PENDING_ORDERS) {
    return {
      ok: false,
      message: "当前下单人数较多，请稍后再试",
    };
  }

  return { ok: true };
}

/** 回调端点限流（未认证入口，需要防止被刷爆日志表） */
export const NOTIFY_RATE_RULE: RateLimitRule = { windowMs: 60_000, max: 60 };

export function checkNotifyRateLimit(ip: string): RateLimitResult {
  return consume(`notify:ip:${ip}`, NOTIFY_RATE_RULE);
}

/** 统计 24 小时内指定 IP 的下单数（观测用，接口保持简单） */
export function countRecentOrdersByEmail(email: string, sinceMs = 86_400_000): number {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(orders)
      .where(
        and(
          sql`lower(${orders.email}) = ${email.trim().toLowerCase()}`,
          gte(orders.createdAt, new Date(Date.now() - sinceMs))
        )
      )
      .get()?.c ?? 0
  );
}

/* ================= 回调限流观测 ================= */

/**
 * 被限流拒绝的回调计数。
 *
 * 这是**需要人工关注**的信号：回调被限流意味着可能有一笔真实支付
 * 的通知未能及时处理（已回 fail 让网关重试，但仍应可见）。
 * 若该计数持续增长，说明限流阈值过低或正在遭受刷量。
 */
const notifyRejects = { total: 0, byIp: new Map<string, number>(), lastAt: 0 };

export function recordRejectedNotify(ip: string): void {
  notifyRejects.total += 1;
  notifyRejects.byIp.set(ip, (notifyRejects.byIp.get(ip) ?? 0) + 1);
  notifyRejects.lastAt = Date.now();
  // 限制 map 规模，避免自身成为内存放大点
  if (notifyRejects.byIp.size > 1000) {
    const trimmed = [...notifyRejects.byIp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 500);
    notifyRejects.byIp = new Map(trimmed);
  }
}

export function getNotifyRejectStats(): { total: number; topIps: [string, number][]; lastAt: number } {
  return {
    total: notifyRejects.total,
    topIps: [...notifyRejects.byIp.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5),
    lastAt: notifyRejects.lastAt,
  };
}

export function resetNotifyRejectStats(): void {
  notifyRejects.total = 0;
  notifyRejects.byIp.clear();
  notifyRejects.lastAt = 0;
}

/* ================= 重新购买限制 ================= */

/**
 * 同一原订单在窗口内可创建的新订单数上限。
 *
 * 即使经过统一的人机验证与频率限制，仍应给单个原订单设独立配额：
 * 它把"一个订单反复重购"的影响面收敛到常数级，
 * 避免攻击者用少量原订单持续占用库存。
 */
export const REPURCHASE_RULE: RateLimitRule = { windowMs: 600_000, max: 3 };

export function checkRepurchaseLimit(sourceOrderNo: string, ip: string): RateLimitResult {
  return consume(`repurchase:${sourceOrderNo}:${ip}`, REPURCHASE_RULE);
}
