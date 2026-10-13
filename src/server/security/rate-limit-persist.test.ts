import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { rateLimitCounters } from "@/db/schema";
import { _flushRateLimits, consume, resetRateBuckets } from "./rate-limit";

/**
 * 限流的持久化保证：
 * 计数不能只存在内存 —— 否则进程重启即清零、攻击者可借重启绕过限流，
 * 多副本时额度还会随副本数放大。
 *
 * 用「清空内存 + 清缓存」模拟进程重启，验证计数能从 DB 恢复。
 */

const RULE = { windowMs: 60_000, max: 3 };

beforeEach(() => {
  db.delete(rateLimitCounters).run();
  resetRateBuckets();
});

/**
 * 模拟进程重启：内存状态清空，只剩 DB。
 * 先强制把缓冲的计数落库（生产中按 1s 间隔批量写入，或在触顶/新窗口时立即写）。
 */
function simulateRestart(): void {
  _flushRateLimits();
  resetRateBuckets();
}

describe("限流计数持久化（230be）", () => {
  it("计数会落库", () => {
    consume("persist:a", RULE);
    consume("persist:a", RULE);
    _flushRateLimits();
    const row = db
      .select()
      .from(rateLimitCounters)
      .where(eq(rateLimitCounters.bucketKey, "persist:a"))
      .get();
    expect(row).toBeDefined();
    expect(row!.count).toBe(2);
  });

  it("重启后（内存清空）仍能读回计数并继续限流", () => {
    expect(consume("reboot:x", RULE).ok).toBe(true);
    expect(consume("reboot:x", RULE).ok).toBe(true);
    expect(consume("reboot:x", RULE).ok).toBe(true);

    // 模拟重启：内存里什么都没有了
    simulateRestart();

    // 第 4 次仍应被拒 —— 计数来自 DB，而不是重新开始
    expect(consume("reboot:x", RULE).ok).toBe(false);
  });

  it("重启前未超限的，重启后额度继续扣减而非重置", () => {
    consume("cont:y", RULE); // 1
    simulateRestart();
    expect(consume("cont:y", RULE).ok).toBe(true); // 2（从 DB 续上）
    expect(consume("cont:y", RULE).ok).toBe(true); // 3
    expect(consume("cont:y", RULE).ok).toBe(false); // 4 → 超限
  });

  it("窗口过期后重新计数（DB 侧也过期）", async () => {
    consume("expire:z", RULE);
    // 把 DB 记录推到过去
    db.update(rateLimitCounters)
      .set({ resetAt: new Date(Date.now() - 60_000) })
      .where(eq(rateLimitCounters.bucketKey, "expire:z"))
      .run();
    simulateRestart();
    // 过期 → 重新开始，应放行
    expect(consume("expire:z", RULE).ok).toBe(true);
  });

  it("不同键互不影响，且都持久化", () => {
    consume("k1", RULE);
    consume("k2", RULE);
    simulateRestart();
    expect(consume("k1", RULE).ok).toBe(true);
    expect(consume("k2", RULE).ok).toBe(true);
  });
});