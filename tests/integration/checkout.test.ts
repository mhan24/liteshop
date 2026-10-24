import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, orders, payments } from "@/db/schema";
import { createOrder, OrderError } from "@/server/orders";
import { hashQueryPassword, verifyQueryPassword } from "@/lib/query-password";
import { resetDb, seedAutoProduct, seedManualProduct, seedCurrency } from "../helpers";

/** 游客下单：金额服务端计算、库存锁定、查单密码 */
describe("游客下单（createOrder）", () => {
  beforeEach(async () => {
    await resetDb();
    await seedCurrency("USD");
  });

  it("成功下单：锁定卡密、金额按服务端价格计算、返回一次性查单密码", async () => {
    const { productId } = await seedAutoProduct("p1", 5, 990);
    const result = await createOrder({
      email: "buyer@test.dev",
      items: [{ slug: "p1", quantity: 2 }],
    });

    expect(result.orderNo).toMatch(/^LS\d{14}[A-F0-9]{6}$/);
    expect(result.totalCents).toBe(1980); // 990 × 2（服务端计算，与买家输入无关）
    expect(result.paymentUrl).toContain("/pay/mock?");
    expect(result.reconciling).toBe(false);

    const reserved = await db.select().from(cards).where(eq(cards.productId, productId));
    const reservedCount = reserved.filter((c) => c.status === "reserved").length;
    expect(reservedCount).toBe(2);

    const orderRows = await db.select().from(orders).where(eq(orders.orderNo, result.orderNo));
    const order = orderRows[0]!;
    expect(order.status).toBe("pending");
    expect(order.queryPasswordHash).not.toContain(result.queryPassword);
    await expect(verifyQueryPassword(order.queryPasswordHash, result.queryPassword)).resolves.toBe(true);

    const payRows = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(payRows).toHaveLength(1);
    expect(payRows[0]!.status).toBe("pending");
    expect(payRows[0]!.isCurrent).toBe(true);
  });

  it("库存不足：整体失败且不留任何订单/占用", async () => {
    await seedAutoProduct("p2", 1);
    await expect(
      createOrder({ email: "buyer@test.dev", items: [{ slug: "p2", quantity: 3 }] })
    ).rejects.toThrow(/OUT_OF_STOCK|库存不足/);
    const allOrders = await db.select().from(orders);
    expect(allOrders).toHaveLength(0);
    const allCards = await db.select().from(cards);
    expect(allCards.every((c) => c.status === "available")).toBe(true);
  });

  it("manual 商品：库存上限原子扣减", async () => {
    await seedManualProduct("m1", 2);
    const r1 = await createOrder({ email: "buyer@test.dev", items: [{ slug: "m1", quantity: 2 }] });
    expect(r1.totalCents).toBe(200);
    await expect(
      createOrder({ email: "other@test.dev", items: [{ slug: "m1", quantity: 1 }] })
    ).rejects.toThrow(/OUT_OF_STOCK|库存不足/);
  });

  it("输入校验：邮箱 / 数量 / 空购物车", async () => {
    await seedAutoProduct("p3", 3);
    await expect(createOrder({ email: "bad", items: [{ slug: "p3", quantity: 1 }] })).rejects.toThrow(
      OrderError
    );
    await expect(
      createOrder({ email: "buyer@test.dev", items: [{ slug: "p3", quantity: 0 }] })
    ).rejects.toThrow(OrderError);
    await expect(createOrder({ email: "buyer@test.dev", items: [] })).rejects.toThrow(OrderError);
  });

  it("查单密码哈希为 Argon2id 且可校验", async () => {
    await seedAutoProduct("p4", 1);
    const r = await createOrder({ email: "buyer@test.dev", items: [{ slug: "p4", quantity: 1 }] });
    const orderRows = await db.select().from(orders).where(eq(orders.orderNo, r.orderNo));
    expect(orderRows[0]!.queryPasswordHash.startsWith("$argon2id$")).toBe(true);
    expect(r.queryPassword).toMatch(/^[2-9A-Z]{8}$/);
    void hashQueryPassword;
  });
});
