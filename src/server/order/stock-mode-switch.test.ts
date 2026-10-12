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

describe("库存模式切换会重置历史订单的占用（修复）", () => {
  /**
   * 场景：一笔未完成订单存续期间，管理员把库存从「有限」切到「不限」再切回「有限」。
   *
   * 无预留台账时无法区分「库存 3 是管理员手填的」还是「3 是剩余量」，
   * 因此切换模式时明确重置旧订单的占用标志（视为管理员手动接管库存数量），
   * 使后续超时释放不会再加一份（否则 3 → 4，库存虚高、潜在超卖）。
   */
  it("有限 → 不限 → 有限 后，过期订单不再回补（库存保持管理员设定值）", async () => {
    const { updateProduct } = await import("@/server/admin/catalog");
    const p = seedManual(3);
    const r = await createOrder({ email: "flip@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2);

    const baseInput = {
      name: "切换测试",
      slug: p.slug,
      description: "d",
      imageUrl: "",
      priceCentsText: "1.00",
      currency: "USD",
      deliveryType: "manual",
      status: "on",
      sort: 0,
    };

    // 切到「不限」
    expect(updateProduct(p.id, { ...baseInput, stockLimit: -1 }).ok).toBe(true);
    expect(stockOf(p.id)).toBe(-1);

    // 再切回有限并手填 3
    const res = updateProduct(p.id, { ...baseInput, stockLimit: 3 });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("库存模式变更");
    expect(stockOf(p.id)).toBe(3);

    // 旧订单超时：占用已在切换时重置，不得再加回一份
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    expect(stockOf(p.id)).toBe(3);
  });

  it("仅调整数量（不切模式）时不重置占用，订单过期仍正常回补", async () => {
    const { updateProduct } = await import("@/server/admin/catalog");
    const p = seedManual(3);
    const r = await createOrder({ email: "noadj@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2);

    // 有限 3 → 有限 10：只是补货，不是模式切换
    const res = updateProduct(p.id, {
      name: "切换测试",
      slug: p.slug,
      description: "d",
      imageUrl: "",
      priceCentsText: "1.00",
      currency: "USD",
      deliveryType: "manual",
      stockLimit: 10,
      status: "on",
      sort: 0,
    });
    expect(res.ok).toBe(true);
    expect(res.message).not.toContain("库存模式变更");
    expect(stockOf(p.id)).toBe(10);

    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    // 订单确实占过 1 份，回补后为 11
    expect(stockOf(p.id)).toBe(11);
  });
});
