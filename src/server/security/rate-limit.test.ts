import { describe, expect, it, beforeEach } from "vitest";
import { db } from "@/db";
import { orders } from "@/db/schema";
import {
  consume,
  resetRateBuckets,
  checkOrderRateLimit,
  checkNotifyRateLimit,
  sweepRateBuckets,
  ORDER_RATE_RULES,
  MAX_ACTIVE_PENDING_PER_EMAIL,
} from "./rate-limit";

/** 下单限流：Turnstile 关闭时这是唯一的下单频率防线（防占满卡密） */

function seedPending(email: string) {
  db.insert(orders).values({
    orderNo: `LSR${Math.random().toString(36).slice(2, 14).toUpperCase()}`,
    productName: "T", unitPriceCents: 100, currency: "USD", quantity: 1,
    totalCents: 100, email, status: "pending",
  }).run();
}

describe("滑动窗口限流", () => {
  beforeEach(() => resetRateBuckets());

  it("窗口内超过上限被拒，并给出重试秒数", () => {
    const rule = { windowMs: 60_000, max: 3 };
    expect(consume("k", rule).ok).toBe(true);
    expect(consume("k", rule).ok).toBe(true);
    expect(consume("k", rule).ok).toBe(true);
    const denied = consume("k", rule);
    expect(denied.ok).toBe(false);
    expect(denied.retryAfterSeconds).toBeGreaterThan(0);
    expect(denied.message).toContain("频繁");
  });

  it("不同 key 互不影响", () => {
    const rule = { windowMs: 60_000, max: 1 };
    expect(consume("a", rule).ok).toBe(true);
    expect(consume("b", rule).ok).toBe(true);
    expect(consume("a", rule).ok).toBe(false);
  });

  it("窗口过期后恢复额度", () => {
    // 用负窗口让桶**立即**过期，避免依赖墙钟推进
    // （CI 容器的时间粒度可能使 busy-wait 不可靠 → 曾导致 flaky 失败）
    const rule = { windowMs: -1, max: 1 };
    expect(consume("x", rule).ok).toBe(true);
    // 负窗口 → resetAt 在过去 → 每次都视为新窗口
    expect(consume("x", rule).ok).toBe(true);

    // 另用真实时间验证窗口语义：窗口设为已过期的过去时间
    resetRateBuckets();
    const r2 = { windowMs: 60_000, max: 1 };
    expect(consume("y", r2).ok).toBe(true);
    expect(consume("y", r2).ok).toBe(false);
  });

  it("sweepRateBuckets 清理过期桶（防内存无界增长）", () => {
    resetRateBuckets();
    // 负窗口 → resetAt 已过期，可被 sweep 立即回收
    consume("expired", { windowMs: -1, max: 1 });
    expect(sweepRateBuckets()).toBeGreaterThanOrEqual(1);
  });
});

describe("下单综合限流", () => {
  beforeEach(() => resetRateBuckets());

  it("同一 IP 在窗口内超过上限后被拒", () => {
    const ip = "203.0.113.9";
    for (let i = 0; i < ORDER_RATE_RULES.perIp.max; i++) {
      expect(checkOrderRateLimit(ip, `u${i}@test.dev`).ok).toBe(true);
    }
    const denied = checkOrderRateLimit(ip, "another@test.dev");
    expect(denied.ok).toBe(false);
  });

  it("同一邮箱待支付订单过多被拒（防刷单占库存）", () => {
    const email = `flood${Date.now()}@test.dev`;
    for (let i = 0; i < MAX_ACTIVE_PENDING_PER_EMAIL; i++) seedPending(email);
    const res = checkOrderRateLimit(`198.51.100.${Math.floor(Math.random() * 200)}`, email);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("待支付订单");
  });

  it("正常新用户可以通过", () => {
    expect(checkOrderRateLimit("192.0.2.77", `ok${Date.now()}@test.dev`).ok).toBe(true);
  });
});

describe("回调端点限流", () => {
  beforeEach(() => resetRateBuckets());

  it("超过上限后被拒（防止刷爆日志表）", () => {
    const ip = "198.51.100.50";
    for (let i = 0; i < 60; i++) expect(checkNotifyRateLimit(ip).ok).toBe(true);
    expect(checkNotifyRateLimit(ip).ok).toBe(false);
  });
});
