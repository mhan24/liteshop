import { beforeEach, describe, expect, it, vi } from "vitest";
import { invalidateConfig } from "@/server/settings";
import { createOrder } from "@/server/orders";
import { resetDb, seedAutoProduct } from "../helpers";

/**
 * 回归：锁卡事务内不得再向连接池借连接。
 *
 * 连接池 max = 10。制造最坏时序：10 个下单事务全部占住连接后（栅栏），清空配置缓存，再放行。
 * 旧实现在事务里读配置（低库存通知），此时需要第 11 个连接，10 个事务互相等待直至超时；
 * 生产上对应「高峰期后台恰好保存设置 / 进程刚重启」的时刻。
 */
const POOL_MAX = 10;
let arrived = 0;
let release: () => void = () => {};
const gate = new Promise<void>((r) => (release = r));

vi.mock("@/server/catalog", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/server/catalog")>();
  return {
    ...mod,
    reserveStock: async (...args: Parameters<typeof mod.reserveStock>) => {
      arrived += 1;
      if (arrived === POOL_MAX) {
        invalidateConfig();
        release();
      }
      await gate; // 所有事务都已持有连接
      return mod.reserveStock(...args);
    },
  };
});

describe("连接池耗尽", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("并发数 = 连接池上限且缓存在事务中途被清空，下单全部成功", async () => {
    await seedAutoProduct("pool1", POOL_MAX);
    const results = await Promise.all(
      Array.from({ length: POOL_MAX }, (_, i) =>
        createOrder({ email: `pool${i}@test.dev`, items: [{ slug: "pool1", quantity: 1 }] })
      )
    );
    expect(results).toHaveLength(POOL_MAX);
  }, 25_000);
});
