import { and, eq, gte, inArray, lte, sql } from "drizzle-orm";
import { db, type DbTransaction } from "@/db";
import { orders, rateLimitCounters } from "@/db/schema";

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

/**
 * 内存滑动窗口（**快速路径**）。
 *
 * 计数同时持久化到 rate_limit_counters：内存用于避免每个请求都写库，
 * 落库用于让限流在**进程重启**与**多副本**下保持一致
 * （否则攻击者可通过重启或把请求分散到多个副本来绕过限流）。
 * 读取时先看内存，缺失则回源 DB；写入时两者同步。
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

/** 从 DB 读取计数（内存缺失时的回源） */
function loadFromDb(key: string, now: number): { count: number; resetAt: number } | null {
  try {
    const row = db
      .select({ count: rateLimitCounters.count, resetAt: rateLimitCounters.resetAt })
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.bucketKey, key))
      .get();
    if (!row) return null;
    const resetAtMs = row.resetAt.getTime();
    if (resetAtMs <= now) return null; // 窗口已过期
    return { count: row.count, resetAt: resetAtMs };
  } catch {
    // DB 不可用时降级为「仅内存」：限流变弱但不会因存储故障而拒绝正常流量
    return null;
  }
}

/**
 * 脏键缓冲：把 DB 写入**合并**成周期性批量落库。
 *
 * 若每次 consume 都直接写库，限流本身就变成写放大（高基数流量下每请求一次
 * INSERT/UPSERT），实测会让容量测试从毫秒级退化到超时。
 * 现改为：只把键标记为脏，最多每 FLUSH_INTERVAL_MS 合并写一次。
 * 代价是「刚发生、尚未落库」的一小段时间内若进程崩溃，该窗口计数会丢失
 * ——但窗口本身很短（分钟级），且内存计数在本进程内始终有效，
 * 因此是可接受的折中：跨重启/多实例一致性的目标仍然达成。
 */
const dirty = new Map<string, { count: number; resetAt: number }>();
const FLUSH_INTERVAL_MS = 1_000;
let lastFlushAt = 0;

/** 把待写计数落库（可批量）；失败不影响内存计数（可用性优先） */
function flushToDb(force = false): void {
  const now = Date.now();
  if (!force && now - lastFlushAt < FLUSH_INTERVAL_MS) return;
  if (dirty.size === 0) {
    lastFlushAt = now;
    return;
  }
  lastFlushAt = now;
  try {
    db.transaction((tx) => {
      for (const [key, v] of dirty) {
        tx.insert(rateLimitCounters)
          .values({ bucketKey: key, count: v.count, resetAt: new Date(v.resetAt), updatedAt: new Date() })
          .onConflictDoUpdate({
            target: rateLimitCounters.bucketKey,
            set: { count: v.count, resetAt: new Date(v.resetAt), updatedAt: new Date() },
          })
          .run();
      }
    });
    dirty.clear();
  } catch {
    // 失败则保留脏数据，下个周期重试；内存计数始终有效
  }
}

/** 标记为待落库（合并写） */
function persistToDb(key: string, count: number, resetAt: number): void {
  dirty.set(key, { count, resetAt });
  flushToDb(false);
}

/** 清理 DB 中已过期的记录 */
export function sweepRateLimitRows(now = Date.now()): number {
  try {
    return db.delete(rateLimitCounters).where(lte(rateLimitCounters.resetAt, new Date(now))).run().changes;
  } catch {
    return 0;
  }
}

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

/** 待对账订单上限：这类订单占用库存且不会自动释放，需单独约束 */
export const MAX_RECONCILING_ORDERS = 20;
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
/** 淘汰目标水位：一次清理到这个数量，避免每个新键都触发排序 */
const EVICT_TARGET = 15_000;

/** 供测试：读取阈值配置 */
export function _rateLimits(): { max: number; target: number } {
  return { max: MAX_BUCKETS, target: EVICT_TARGET };
}

export function consume(key: string, rule: RateLimitRule): RateLimitResult {
  const now = Date.now();

  // 节流式清理 + 容量保护（曾缺失：sweepRateBuckets 已导出但无人调用，
  // Map 也无容量上限，导致过期记录长期滞留内存）。
  if (now - lastSweepAt >= SWEEP_THROTTLE_MS) {
    lastSweepAt = now;
    sweepRateBuckets(now);
  }
  // 容量保护：**批量**淘汰，而不是每超一条就删一条。
  // 早期实现是「删掉超出的那几条」，在持续高基数流量下会退化成
  // 「每个新键触发一次全量排序」——限流本身成了 CPU 放大。
  // 现改为允许适度超出，达到触发点后一次清理到低水位，
  // 把排序的摊销成本降到 O(1)。（与管理员登录限流同一思路。）
  if (buckets.size > MAX_BUCKETS) {
    const sorted = [...buckets.entries()].sort((a, b) => a[1].resetAt - b[1].resetAt);
    for (let i = 0; i < buckets.size - EVICT_TARGET; i++) buckets.delete(sorted[i][0]);
  }

  // 内存优先，缺失则回源 DB（重启后仍能恢复计数）
  let rec = buckets.get(key);
  if (!rec || rec.resetAt <= now) {
    rec = loadFromDb(key, now) ?? undefined;
  }

  if (!rec || rec.resetAt <= now) {
    const fresh = { count: 1, resetAt: now + rule.windowMs };
    buckets.set(key, fresh);
    // 新窗口只入脏缓冲（每秒批量落库）。这里刻意不强制 flush：
    // 高基数流量下每个新键都开一个写事务会把限流变成写放大。
    // 代价是崩溃时最多丢失 1 秒内的新键计数 —— 可接受（窗口为分钟级，
    // 且同一键的后续请求会再次触达并写回）。
    persistToDb(key, fresh.count, fresh.resetAt);
    return { ok: true };
  }
  if (rec.count >= rule.max) {
    // 达到上限：强制落库，保证「已触发限制」这一事实跨重启不丢
    buckets.set(key, rec);
    persistToDb(key, rec.count, rec.resetAt);
    flushToDb(true);
    return {
      ok: false,
      retryAfterSeconds: Math.ceil((rec.resetAt - now) / 1000),
      message: `操作过于频繁，请 ${Math.ceil((rec.resetAt - now) / 1000)} 秒后再试`,
    };
  }
  rec.count += 1;
  buckets.set(key, rec);
  persistToDb(key, rec.count, rec.resetAt);
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

/** 供测试：强制把待写计数落库 */
export function _flushRateLimits(): void {
  flushToDb(true);
}

export function resetRateBuckets(): void {
  buckets.clear();
  dirty.clear();
  lastSweepAt = 0;
  lastFlushAt = 0;
}

/**
 * 查单/取消的频率限制（独立于下单与回调）。
 *
 * 背景：查单接口是「订单号 + 邮箱」双因子，若不限流会成为邮箱枚举的通道；
 * 取消订单同样按订单号 + 邮箱校验，需要独立预算，避免与其它入口
 * 共用额度而互相挤占。
 */

/** 查单：同一 IP 每分钟 20 次 */
export function checkLookupRateLimit(ip: string): RateLimitResult {
  return consume(`lookup:${ip}`, { windowMs: 60_000, max: 20 });
}

/** 取消订单：同一 IP 每分钟 10 次（写操作，配额更紧） */
export function checkCancelRateLimit(ip: string): RateLimitResult {
  return consume(`cancel:${ip}`, { windowMs: 60_000, max: 10 });
}

/** 双因子不匹配：同一 IP 每分钟 10 次，防邮箱枚举 */
export function checkLookupMissRateLimit(ip: string): RateLimitResult {
  return consume(`lookup-miss:${ip}`, { windowMs: 60_000, max: 10 });
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

  return checkActiveOrderCapacity();
}

/** 前置检查减少压力；建单事务中再次调用，保证总量约束与插入原子。 */
export function checkActiveOrderCapacity(
  database: Pick<DbTransaction, "select"> = db
): RateLimitResult {
  // 全局兜底：防止攻击者疯狂换 IP/邮箱占满库存。
  //
  // 必须同时统计 **reconciling（待对账）**：这类订单是「创建支付结果未知」
  // 时保留的，**同样占用库存/卡密，且不会因普通超时而自动释放**
  // （网关可能已建单）。若不计入，网关故障期间连续产生 reconciling 订单
  // 就能绕过本限制持续锁库存，最终导致长期无货可售。
  const active = database
    .select({ c: sql<number>`count(*)` })
    .from(orders)
    .where(inArray(orders.status, ["pending", "reconciling"]))
    .get()?.c ?? 0;
  if (active >= MAX_ACTIVE_PENDING_ORDERS) {
    return {
      ok: false,
      message: "当前下单人数较多，请稍后再试",
    };
  }

  // 待对账订单单独监控：达到独立阈值时告警式拒绝。
  // 这些订单无法自动释放，堆积即意味着库存被长期锁定，需人工介入。
  const reconciling = database
    .select({ c: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.status, "reconciling"))
    .get()?.c ?? 0;
  if (reconciling >= MAX_RECONCILING_ORDERS) {
    return {
      ok: false,
      message: "系统有待核对的支付订单，请稍后再试或联系客服",
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

/** 独立轮询预算：一个标签页约 30 次/分钟；不占双因子查单预算。 */
export function checkOrderStatusRateLimit(ip: string, orderNo: string): RateLimitResult {
  const perIp = consume(`status:ip:${ip}`, { windowMs: 60_000, max: 120 });
  if (!perIp.ok) return perIp;
  return consume(`status:order:${ip}:${orderNo.slice(0, 64)}`, { windowMs: 60_000, max: 60 });
}
