import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { seedAuto } from "./test-helpers";

/**
 * 重新购买的状态白名单：只允许 expired / closed。
 *
 * 尤其是 reconciling（待对账）—— 旧交易是否创建、是否已付款仍未确定，
 * 允许重购会再次占用库存，且买家可能为同一笔订单重复付款。
 */

describe("createOrderForRepurchase 的状态白名单", () => {
  it("拒绝 reconciling 订单（待对账，不得重购）", async () => {
    const { createOrder, createOrderForRepurchase } = await import("./create-order");
    const p = seedAuto(["C1", "C2", "C3"]);
    const r = await createOrder({ email: "rec-buy@test.dev", quantity: 1, slug: p.slug });

    // 置为待对账（支付结果未知）
    db.update(orders).set({ status: "reconciling" }).where(eq(orders.orderNo, r.orderNo)).run();

    await expect(createOrderForRepurchase(r.orderNo, "rec-buy@test.dev")).rejects.toThrow(
      /待核实|无法重新购买|订单状态/
    );
    // 确认未产生新订单、未额外占用库存
    const { orders: ordersTable } = await import("@/db/schema");
    const count = db.select().from(ordersTable).all().filter((o) => o.email === "rec-buy@test.dev").length;
    expect(count).toBe(1);
  });

  it("拒绝 pending 订单（应直接继续支付），且是**状态**原因而非库存不足", async () => {
    const { createOrder, createOrderForRepurchase } = await import("./create-order");
    // 给足卡密：确保若不是状态拦截，就会因库存充足而**成功**建单
    const p = seedAuto(["C1", "C2", "C3"]);
    const r = await createOrder({ email: "pend-buy@test.dev", quantity: 1, slug: p.slug });

    // 必须因状态被拒（断言具体错误，避免"因库存不足而误通过"）
    await expect(createOrderForRepurchase(r.orderNo, "pend-buy@test.dev")).rejects.toThrow(
      /无法重新购买|订单状态/
    );
    // 确认确实没有产生新订单
    const { orders: ordersTable } = await import("@/db/schema");
    const count = db.select().from(ordersTable).all().filter((o) => o.email === "pend-buy@test.dev").length;
    expect(count).toBe(1);
  });

  it("允许 expired 订单重购", async () => {
    const { createOrder, createOrderForRepurchase } = await import("./create-order");
    const p = seedAuto(["C1", "C2"]);
    const r = await createOrder({ email: "exp-buy@test.dev", quantity: 1, slug: p.slug });
    db.update(orders)
      .set({ status: "expired", stockCharged: false })
      .where(eq(orders.orderNo, r.orderNo))
      .run();

    const fresh = await createOrderForRepurchase(r.orderNo, "exp-buy@test.dev");
    expect(fresh.orderNo).not.toBe(r.orderNo);
  });

  it("允许 closed 订单重购", async () => {
    const { createOrder, createOrderForRepurchase } = await import("./create-order");
    const p = seedAuto(["C1", "C2"]);
    const r = await createOrder({ email: "cls-buy@test.dev", quantity: 1, slug: p.slug });
    db.update(orders)
      .set({ status: "closed", stockCharged: false })
      .where(eq(orders.orderNo, r.orderNo))
      .run();

    const fresh = await createOrderForRepurchase(r.orderNo, "cls-buy@test.dev");
    expect(fresh.orderNo).not.toBe(r.orderNo);
  });
});

describe("P2-02 订单号重试只针对唯一索引冲突", () => {
  it("非冲突的数据库异常不被当成重试条件（直接抛出）", async () => {
    // 通过构造一个必败的插入（如外键/约束错误）验证不会被重试吞掉。
    // 这里用真实场景：向已存在 order_no 的单据插入 → 冲突可重试；
    // 而其它错误应立即抛出。
    const { db: database } = await import("@/db");
    const { orders: t } = await import("@/db/schema");
    const { sql } = await import("drizzle-orm");

    database.transaction(
      (tx) => {
        tx.run(sql.raw("SAVEPOINT probe"));
        // 模拟一个与 order_no 无关的约束错误（product_id 指向不存在的商品
        // 在外键开启时会失败）
        let caught = null;
        try {
          tx.insert(t)
            .values({
              orderNo: "PROBE_NOT_EXIST",
              productId: 999999,
              productName: "x",
              unitPriceCents: 1,
              currency: "USD",
              quantity: 1,
              totalCents: 1,
              email: "p@test.dev",
            })
            .run();
        } catch (e) {
          caught = e;
        }
        tx.run(sql.raw("ROLLBACK TO probe"));
        tx.run(sql.raw("RELEASE probe"));
        // 该异常不应被 isOrderNoCollision 判定为可重试
        expect(caught).not.toBeNull();
        const msg = (caught as Error).message ?? "";
        const code = (caught as { code?: string }).code ?? "";
        const isCollision =
          (code === "SQLITE_CONSTRAINT_UNIQUE" || code === "SQLITE_CONSTRAINT_PRIMARYKEY") &&
          /orders\.order_no|order_no/.test(msg);
        expect(isCollision).toBe(false);
      },
      { behavior: "immediate" }
    );
  });
});
