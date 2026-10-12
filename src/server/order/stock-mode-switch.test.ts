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

describe("库存模式切换受未结束订单约束（修复）", () => {
  /**
   * 早期做法是切换模式时重置旧订单的 stockCharged，但那只是转移问题：
   * 旧订单仍有效、仍可能付款要求交付，库存系统却不再承认其占用，
   * 切回有限库存后可再次卖出 → 超卖。
   *
   * 现改为：存在未结束订单时禁止切换，要求先完成/取消。
   */

  const baseInput = (slug: string) => ({
    name: "切换测试",
    slug,
    description: "d",
    imageUrl: "",
    priceCentsText: "1.00",
    currency: "USD",
    deliveryType: "manual",
    status: "on",
    sort: 0,
  });

  it("有未结束订单时禁止切换到不限", async () => {
    const { createOrder } = await import("./create-order");
    const { updateProduct } = await import("@/server/admin/catalog");
    const p = seedManual(3);
    const r = await createOrder({ email: "flip@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2);

    const res = updateProduct(p.id, { ...baseInput(p.slug), stockLimit: -1 });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未结束订单");
    // 库存与占用均未被破坏
    expect(stockOf(p.id)).toBe(2);
    expect(db.select().from(orders).where(eq(orders.orderNo, r.orderNo)).get()!.stockCharged).toBe(true);
  });

  it("订单结束（取消）后允许切换，且库存正确", async () => {
    const { createOrder } = await import("./create-order");
    const { updateProduct } = await import("@/server/admin/catalog");
    const { cancelPendingOrder } = await import("./fulfill-order");
    const p = seedManual(3);
    const r = await createOrder({ email: "flip2@test.dev", quantity: 1, slug: p.slug });

    expect(cancelPendingOrder(r.orderNo, "flip2@test.dev").ok).toBe(true);
    expect(stockOf(p.id)).toBe(3); // 占用释放，回到初始

    // 已无未结束订单 → 可以切换
    expect(updateProduct(p.id, { ...baseInput(p.slug), stockLimit: -1 }).ok).toBe(true);
    expect(stockOf(p.id)).toBe(-1);

    // 切回有限同样允许
    expect(updateProduct(p.id, { ...baseInput(p.slug), stockLimit: 3 }).ok).toBe(true);
    expect(stockOf(p.id)).toBe(3);
  });

  it("仅调整数量（不切模式）不受限制，订单过期仍正常回补", async () => {
    const { createOrder } = await import("./create-order");
    const { updateProduct } = await import("@/server/admin/catalog");
    const { sweepExpiredOrders } = await import("./expire-orders");
    const p = seedManual(3);
    const r = await createOrder({ email: "noadj@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2);

    // 有限 3 → 有限 10：只是补货，不是模式切换
    const res = updateProduct(p.id, { ...baseInput(p.slug), stockLimit: 10 });
    expect(res.ok).toBe(true);
    expect(stockOf(p.id)).toBe(10);

    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    // 订单确实占过 1 份，回补后为 11
    expect(stockOf(p.id)).toBe(11);
  });

  it("不限 → 有限也受同一约束", async () => {
    const { createOrder } = await import("./create-order");
    const { updateProduct } = await import("@/server/admin/catalog");
    const p = seedManual(-1);
    const r = await createOrder({ email: "flip4@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(-1);

    const res = updateProduct(p.id, { ...baseInput(p.slug), stockLimit: 3 });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未结束订单");
    expect(stockOf(p.id)).toBe(-1);
    void r;
  });
});
