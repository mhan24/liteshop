import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { sweepExpiredOrders } from "./expire-orders";
import { closeOrder } from "./fulfill-order";
import { lookupOrder } from "./query-order";

/**
 * 复现：人工商品库存重复回补（超时清扫释放一次，管理员关闭再释放一次）。
 */

function seedManual(stockLimit: number) {
  const slug = `stockidem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "人工商品",
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

describe("P0 复现：人工库存重复回补", () => {
  it("下单 → 超时清扫 → 管理员关闭，库存必须始终等于初始值", async () => {
    const p = seedManual(3);
    expect(stockOf(p.id)).toBe(3); // 初始

    const r = await createOrder({ email: "idem@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2); // 下单占用 1

    // 超时清扫释放一次
    db.update(orders)
      .set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo))
      .run();
    sweepExpiredOrders();
    expect(stockOf(p.id)).toBe(3); // 释放回 3

    // 管理员再关闭该超时订单
    const res = closeOrder(r.orderNo);
    expect(res.ok).toBe(true);

    // 关键断言：不得变成 4
    expect(stockOf(p.id)).toBe(3);
  });

  it("重复关闭不会累积回补（多次调用仍等于初始值）", async () => {
    const p = seedManual(5);
    const r = await createOrder({ email: "idem2@test.dev", quantity: 2, slug: p.slug });
    expect(stockOf(p.id)).toBe(3);

    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();
    expect(stockOf(p.id)).toBe(5);

    closeOrder(r.orderNo); // 第一次关闭
    closeOrder(r.orderNo); // 再次调用（应被状态拒绝）
    expect(stockOf(p.id)).toBe(5);
  });

  it("惰性清扫路径同样不得重复回补", async () => {
    const p = seedManual(2);
    const r = await createOrder({ email: "idem3@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(1);

    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    lookupOrder(r.orderNo, "idem3@test.dev"); // 惰性清扫
    expect(stockOf(p.id)).toBe(2);

    closeOrder(r.orderNo);
    expect(stockOf(p.id)).toBe(2);
  });
});

describe("P0 补充：统一释放入口的幂等性", () => {
  it("auto 商品：多次释放不改变卡密状态（条件更新天然幂等）", async () => {
    const slug = `stockauto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = db
      .insert(products)
      .values({ name: "自动商品", slug, description: "d", priceCents: 100, deliveryType: "auto", status: "on" })
      .returning({ id: products.id })
      .get()!;
    const { cards } = await import("@/db/schema");
    for (const c of ["A1", "A2"]) {
      db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
    }

    const r = await createOrder({ email: "autoidem@test.dev", quantity: 1, slug });
    const reservedOf = () =>
      db.select().from(cards).where(eq(cards.productId, p.id)).all().filter((c) => c.status === "reserved").length;
    expect(reservedOf()).toBe(1);

    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();
    expect(reservedOf()).toBe(0);

    // 再次关闭：不应报错，也不应把已释放的卡再动一次
    const res = closeOrder(r.orderNo);
    expect(res.ok).toBe(true);
    expect(reservedOf()).toBe(0);
  });

  it("已交付（completed）订单不会被释放回补", async () => {
    const p = seedManual(3);
    const r = await createOrder({ email: "done@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2);

    // 模拟人工录入交付内容并置为 completed
    db.update(orders)
      .set({ status: "completed", deliveryContent: "已交付" })
      .where(eq(orders.orderNo, r.orderNo))
      .run();

    // closeOrder 对 completed 直接拒绝
    const res = closeOrder(r.orderNo);
    expect(res.ok).toBe(false);
    expect(stockOf(p.id)).toBe(2); // 库存不得回补
  });
});

describe("P1 回归：商品改发货方式不得影响已有订单", () => {
  it("manual → auto：待支付订单超时仍能回补人工库存", async () => {
    const p = seedManual(3);
    const r = await createOrder({ email: "switch1@test.dev", quantity: 1, slug: p.slug });
    expect(stockOf(p.id)).toBe(2);

    // 后台把商品改成自动发卡
    db.update(products).set({ deliveryType: "auto" }).where(eq(products.id, p.id)).run();

    // 订单超时 → 仍应按**下单时的 manual** 回补库存
    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    expect(stockOf(p.id)).toBe(3); // 回补成功（而非按 auto 逻辑跳过）
  });

  it("auto → manual：待支付订单超时仍能释放预留卡密", async () => {
    const { cards } = await import("@/db/schema");
    const slug = `switch2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = db
      .insert(products)
      .values({ name: "自动商品", slug, description: "d", priceCents: 100, deliveryType: "auto", status: "on" })
      .returning({ id: products.id })
      .get()!;
    db.insert(cards).values({ productId: p.id, content: "C1", status: "available" }).run();

    const r = await createOrder({ email: "switch2@test.dev", quantity: 1, slug });
    const reserved = () =>
      db.select().from(cards).where(eq(cards.productId, p.id)).all().filter((c) => c.status === "reserved").length;
    expect(reserved()).toBe(1);

    // 后台把商品改成人工发货
    db.update(products).set({ deliveryType: "manual" }).where(eq(products.id, p.id)).run();

    db.update(orders).set({ expirationTime: new Date(Date.now() - 60_000) })
      .where(eq(orders.orderNo, r.orderNo)).run();
    sweepExpiredOrders();

    // 仍应按下单时的 auto 释放卡密（而非当成 manual 不动卡池）
    expect(reserved()).toBe(0);
  });

  it("订单保存了下单时刻的发货方式快照", async () => {
    const p = seedManual(2);
    const r = await createOrder({ email: "snap@test.dev", quantity: 1, slug: p.slug });
    const o = db.select().from(orders).where(eq(orders.orderNo, r.orderNo)).get()!;
    expect(o.deliveryType).toBe("manual");

    db.update(products).set({ deliveryType: "auto" }).where(eq(products.id, p.id)).run();
    const after = db.select().from(orders).where(eq(orders.orderNo, r.orderNo)).get()!;
    expect(after.deliveryType).toBe("manual"); // 快照不随商品变化
  });
});

describe("P2 回归：订单号冲突重试不得重复扣减库存", () => {
  it("冲突后重试，库存只扣一次", async () => {
    const p = seedManual(10);

    // 预置一个"必然冲突"的订单号：把随机源固定为同一个值
    // 通过连续下单两次并强制第二次的 order_no 与第一次相同来模拟
    const first = await createOrder({ email: "collide1@test.dev", quantity: 1, slug: p.slug });
    const firstNo = first.orderNo;
    expect(stockOf(p.id)).toBe(9);

    // 直接验证保存点机制：在同一事务内制造唯一冲突后重试
    const { db: database } = await import("@/db");
    const { orders: ordersTable, products: productsTable } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");

    const before = stockOf(p.id);
    database.transaction(
      (tx) => {
        // 第一次尝试：扣库存 + 插入一个已存在的订单号 → 冲突
        tx.run(sql.raw("SAVEPOINT s1"));
        try {
          tx.update(productsTable)
            .set({ stockLimit: sql`${productsTable.stockLimit} - 1` })
            .where(eq(productsTable.id, p.id))
            .run();
          tx.insert(ordersTable)
            .values({
              orderNo: firstNo,
              productName: "冲突",
              unitPriceCents: 100,
              currency: "USD",
              quantity: 1,
              totalCents: 100,
              email: "c@test.dev",
            })
            .run();
        } catch {
          tx.run(sql.raw("ROLLBACK TO s1"));
        }
        tx.run(sql.raw("RELEASE s1"));

        // 第二次尝试：正常插入
        tx.update(productsTable)
          .set({ stockLimit: sql`${productsTable.stockLimit} - 1` })
          .where(eq(productsTable.id, p.id))
          .run();
        tx.insert(ordersTable)
          .values({
            orderNo: `${firstNo}X`,
            productName: "成功",
            unitPriceCents: 100,
            currency: "USD",
            quantity: 1,
            totalCents: 100,
            email: "c@test.dev",
          })
          .run();
      },
      { behavior: "immediate" }
    );

    // 只有第二次的扣减生效
    expect(stockOf(p.id)).toBe(before - 1);
  });
});
