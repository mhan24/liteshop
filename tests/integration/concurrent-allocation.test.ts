import { beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, orders } from "@/db/schema";
import { createOrder } from "@/server/orders";
import { resetDb, seedAutoProduct, seedCurrency } from "../helpers";

/**
 * 并发卡密分配：PostgreSQL 行级锁（FOR UPDATE SKIP LOCKED）保证一卡不两卖。
 * 并发下单数量 = 卡密数量时恰好全部成功；超出时多余订单失败且不产生半占用。
 */
describe("并发卡密分配", () => {
  beforeEach(async () => {
    await resetDb();
    await seedCurrency("USD");
  });

  it("并发 N 单抢 N 张卡：全部成功且卡密不重复", async () => {
    const total = 10;
    await seedAutoProduct("race1", total);
    const results = await Promise.all(
      Array.from({ length: total }, (_, i) =>
        createOrder({ email: `buyer${i}@test.dev`, items: [{ slug: "race1", quantity: 1 }] })
      )
    );
    expect(results).toHaveLength(total);

    const allCards = await db.select().from(cards);
    const reserved = allCards.filter((c) => c.status === "reserved");
    expect(reserved).toHaveLength(total);
    const distinctOrders = new Set(reserved.map((c) => c.reservedOrderId));
    expect(distinctOrders.size).toBe(total); // 每个订单恰好 1 张卡，无重复分配
  });

  it("并发超卖尝试：库存不足的订单失败，成功订单之间零重复", async () => {
    await seedAutoProduct("race2", 5);
    const attempts = 12;
    const settled = await Promise.allSettled(
      Array.from({ length: attempts }, (_, i) =>
        createOrder({ email: `racer${i}@test.dev`, items: [{ slug: "race2", quantity: 1 }] })
      )
    );
    const fulfilled = settled.filter((s) => s.status === "fulfilled");
    const rejected = settled.filter((s) => s.status === "rejected");
    expect(fulfilled).toHaveLength(5);
    expect(rejected).toHaveLength(7);

    // 失败订单不留任何残留：订单数 = 5，卡密全部 reserved 且各属一个订单
    const allOrders = await db.select().from(orders);
    expect(allOrders).toHaveLength(5);
    expect(allOrders.every((o) => o.status === "pending")).toBe(true);
    const allCards = await db.select().from(cards);
    expect(allCards.filter((c) => c.status === "reserved")).toHaveLength(5);
    expect(allCards.filter((c) => c.status === "available")).toHaveLength(0);
  });

  it("同一订单内多商品多数量：占卡数量精确", async () => {
    await seedAutoProduct("multi-a", 3);
    await seedAutoProduct("multi-b", 4);
    const r = await createOrder({
      email: "buyer@test.dev",
      items: [
        { slug: "multi-a", quantity: 2 },
        { slug: "multi-b", quantity: 3 },
      ],
    });
    const orderRows = await db.select().from(orders).where(eq(orders.orderNo, r.orderNo));
    const reserved = await db
      .select()
      .from(cards)
      .where(and(eq(cards.reservedOrderId, orderRows[0]!.id), eq(cards.status, "reserved")));
    expect(reserved).toHaveLength(5);
  });
});
