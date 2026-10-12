import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { sweepExpiredOrders } from "./expire-orders";

/**
 * 复现：管理员把「有限库存」改为「不限库存」后，原订单超时释放
 * 会对 -1 执行 +quantity，得到 0（意外售罄）。
 */

function seedManual(stockLimit: number) {
  const slug = `mode-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "切换测试",
      slug,
      description: "d",
      priceCents: 100,
      deliveryType: "manual",
      stockLimit,
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  return { id: p.id, slug };
}

const stockOf = (id: number) =>
  db.select().from(products).where(eq(products.id, id)).get()!.stockLimit;

describe("P1 复现：有限 → 不限 的库存模式切换", () => {
  it("改为不限(-1)后原订单超时，不得把库存算成 0", async () => {
    const p = seedManual(3);
    const r = await createOrder({ email: "mode@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2);

    // 管理员把库存改为「不限」
    db.update(products).set({ stockLimit: -1 }).where(eq(products.id, p.id)).run();
    expect(stockOf(p.id)).toBe(-1);

    // 原订单超时释放
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    // 关键：-1 是哨兵值，不能被加 quantity 变成 0（售罄）
    expect(stockOf(p.id)).toBe(-1);
  });

  it("仍是有限库存时正常回补", async () => {
    const p = seedManual(3);
    const r = await createOrder({ email: "mode2@test.dev", quantity: 2, slug: p.slug });
    expect(stockOf(p.id)).toBe(1);

    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    expect(stockOf(p.id)).toBe(3);
  });
});
