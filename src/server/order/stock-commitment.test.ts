import Database from "better-sqlite3";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { orders, products } from "@/db/schema";
import { seedManual } from "./test-helpers";

/**
 * P1-01 复现：库存模式切换会清除旧订单的占用标志，
 * 导致实际库存承诺可能超过可用库存（超卖）。
 */

const stockOf = (id: number) =>
  db.select().from(products).where(eq(products.id, id)).get()!.stockLimit;

const baseInput = (slug: string) => ({
  name: "库存承诺",
  slug,
  description: "d",
  imageUrl: "",
  priceCentsText: "1.00",
  currency: "USD",
  deliveryType: "manual",
  status: "on",
  sort: 0,
});

describe("P1-01 库存模式切换导致超卖", () => {
  it("存在未结束订单时禁止切换，保证库存承诺不被破坏（修复后）", async () => {
    const { createOrder } = await import("./create-order");
    const { updateProduct } = await import("@/server/admin/catalog");
    const p = seedManual(1);

    // 买家 A 下单，占用唯一 1 件
    const a = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(0);
    expect(db.select().from(orders).where(eq(orders.orderNo, a.orderNo)).get()!.stockCharged).toBe(true);

    // 修复后：A 订单仍未结束 → 不允许切换到不限
    const switchRes = updateProduct(p.id, { ...baseInput(p.slug), stockLimit: -1 });
    expect(switchRes.ok).toBe(false);
    expect(switchRes.message).toContain("未结束订单");

    // 库存承诺未被破坏：仍是 0，占用标志保留
    expect(stockOf(p.id)).toBe(0);
    expect(db.select().from(orders).where(eq(orders.orderNo, a.orderNo)).get()!.stockCharged).toBe(true);

    // 无法再卖出第二件（不会超卖）
    await expect(
      createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug })
    ).rejects.toThrow(/库存不足/);

    // A 取消/过期后，占用释放、库存回到 1
    const { cancelPendingOrder } = await import("./fulfill-order");
    expect(cancelPendingOrder(a.orderNo, "a@test.dev").ok).toBe(true);
    expect(stockOf(p.id)).toBe(1);

    // 此时才允许切换模式
    expect(updateProduct(p.id, { ...baseInput(p.slug), stockLimit: -1 }).ok).toBe(true);
    expect(stockOf(p.id)).toBe(-1);
  });

  it("存在未结束订单时禁止切换库存模式（修复后）", async () => {
    const { createOrder } = await import("./create-order");
    const { updateProduct } = await import("@/server/admin/catalog");
    const p = seedManual(1);
    const a = await createOrder({ email: "c@test.dev", quantity: 1, slug: p.slug });

    const res = updateProduct(p.id, { ...baseInput(p.slug), stockLimit: -1 });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/未结束|未完成|待支付|占用/);

    // 占用标志不被清除
    expect(db.select().from(orders).where(eq(orders.orderNo, a.orderNo)).get()!.stockCharged).toBe(true);
    expect(stockOf(p.id)).toBe(0);
  });
});

describe("P1 复审：守卫只查商品当前类型，未查历史订单快照", () => {
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

  it("manual → auto → manual 序列不再绕过守卫（修复后）", async () => {
    const { createOrder } = await import("./create-order");
    const { updateProduct } = await import("@/server/admin/catalog");
    const p = seedManual(-1);

    // 买家 A 按人工发货下单（不限库存）
    const a = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const aCharged = db.select().from(orders).where(eq(orders.orderNo, a.orderNo)).get()!;
    expect(aCharged.deliveryType).toBe("manual");
    expect(aCharged.status).toBe("pending");

    // ① 人工 → 自动（库存仍不限）
    expect(updateProduct(p.id, { ...baseInput(p.slug), deliveryType: "auto", stockLimit: -1 }).ok).toBe(true);

    // ② 自动 → 人工 + 有限库存 1：A 的人工订单仍未结束 → 必须被拒绝
    const res = updateProduct(p.id, { ...baseInput(p.slug), deliveryType: "manual", stockLimit: 1 });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("未结束订单");
    expect(res.message).toContain("人工发货"); // 提示依据的是订单快照

    // 库存仍是不限，未被写成 1
    expect(stockOf(p.id)).toBe(-1);

    // A 取消后才允许切换
    const { cancelPendingOrder } = await import("./fulfill-order");
    expect(cancelPendingOrder(a.orderNo, "a@test.dev").ok).toBe(true);
    expect(updateProduct(p.id, { ...baseInput(p.slug), deliveryType: "manual", stockLimit: 1 }).ok).toBe(true);
    expect(stockOf(p.id)).toBe(1);
  });
});


it("独立连接在编辑事务开始前提交订单，守卫必须看到该订单（P2-03）", async () => {
  const { updateProduct } = await import("@/server/admin/catalog");
  const p = seedManual(2);
  const second = new Database(db.$client.name);
  second.pragma("foreign_keys = ON");
  const original = db.transaction.bind(db);
  const no = `audit-race-${Date.now()}`;
  const spy = vi.spyOn(db, "transaction").mockImplementationOnce((...args) => {
    second.transaction(() => {
      second.prepare("UPDATE products SET stock_limit=stock_limit-1 WHERE id=?").run(p.id);
      second.prepare("INSERT INTO orders(order_no,product_id,product_name,unit_price_cents,currency,quantity,total_cents,email,status,stock_charged,delivery_type) VALUES(?,?,'race',100,'USD',1,100,'race@example.test','pending',1,'manual')").run(no,p.id);
    }).immediate();
    return original(...args);
  });
  try {
    const result = updateProduct(p.id, { ...baseInput(p.slug), stockLimit: -1 });
    expect(result.ok).toBe(false);
    expect(result.message).toContain("未结束订单");
    expect(stockOf(p.id)).toBe(1);
    expect(db.select().from(orders).where(eq(orders.orderNo,no)).get()!.stockCharged).toBe(true);
  } finally { spy.mockRestore(); second.close(); }
});


it("建单在事务内读取独立连接刚提交的库存模式", async () => {
  const { createOrder } = await import("./create-order");
  const p = seedManual(-1);
  const second = new Database(db.$client.name);
  const original = db.transaction.bind(db);
  const spy = vi.spyOn(db, "transaction").mockImplementationOnce((...args) => {
    second.prepare("UPDATE products SET stock_limit=1 WHERE id=?").run(p.id);
    return original(...args);
  });
  try {
    const r = await createOrder({ slug:p.slug, email:"fresh@example.test", quantity:1 });
    expect(stockOf(p.id)).toBe(0);
    expect(db.select().from(orders).where(eq(orders.orderNo,r.orderNo)).get()!.stockCharged).toBe(true);
  } finally { spy.mockRestore(); second.close(); }
});
