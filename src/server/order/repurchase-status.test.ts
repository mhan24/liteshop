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
