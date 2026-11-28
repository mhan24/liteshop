import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
});

describe("滑动窗口限流", () => {
  it("短窗口触发清理时保留长窗口的请求", async () => {
    vi.useFakeTimers();
    const { rateLimit } = await import("@/lib/rate-limit");
    expect(rateLimit("long", 1, 900_000).ok).toBe(true);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit("short", 1, 60_000).ok).toBe(true);
    expect(rateLimit("long", 1, 900_000).ok).toBe(false);
    vi.advanceTimersByTime(840_000);
    expect(rateLimit("long", 1, 900_000).ok).toBe(true);
  });

  it("达到容量后保留现有额度，其他键到期后继续接受新请求", async () => {
    vi.useFakeTimers();
    const { rateLimit } = await import("@/lib/rate-limit");
    expect(rateLimit("long", 1, 900_000).ok).toBe(true);
    for (let i = 1; i < 5_000; i++) expect(rateLimit(String(i), 1, 60_000).ok).toBe(true);
    expect(rateLimit("new", 1, 60_000).ok).toBe(false);
    vi.advanceTimersByTime(60_001);
    expect(rateLimit("new", 1, 60_000).ok).toBe(true);
    expect(rateLimit("long", 1, 900_000).ok).toBe(false);
  });
});
