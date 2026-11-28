import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { cards, orders, payments } from "@/db/schema";
import { createOrder, OrderError } from "@/server/orders";
import * as orderNumbers from "@/lib/order-no";
import { checkoutAction } from "@/actions/shop";
import { mockAdapter } from "@/server/payments/mock";
import { hashQueryPassword, verifyQueryPassword } from "@/lib/query-password";
import { resetDb, seedAutoProduct } from "../helpers";

vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

/** 游客下单：金额服务端计算、卡密锁定、一次性查单密码 */
describe("游客下单（createOrder）", () => {
  beforeEach(async () => {
    await resetDb();
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
    expect(reserved.filter((c) => c.status === "reserved")).toHaveLength(2);

    const orderRows = await db.select().from(orders).where(eq(orders.orderNo, result.orderNo));
    const order = orderRows[0]!;
    expect(order.status).toBe("pending");
    expect(order.queryPasswordHash).not.toContain(result.queryPassword);
    await expect(verifyQueryPassword(order.queryPasswordHash, result.queryPassword)).resolves.toBe(true);

    const payRows = await db.select().from(payments).where(eq(payments.orderId, order.id));
    expect(payRows).toHaveLength(1);
    expect(payRows[0]!.status).toBe("pending");
    expect(payRows[0]!.channel).toBe("mock");
    expect(payRows[0]!.isCurrent).toBe(true);
  });

  it("库存不足：整体失败且不留任何订单/占用", async () => {
    await seedAutoProduct("p2", 1);
    await expect(
      createOrder({ email: "buyer@test.dev", items: [{ slug: "p2", quantity: 3 }] })
    ).rejects.toMatchObject({ code: "OUT_OF_STOCK", message: expect.stringContaining("库存不足") });
    const allOrders = await db.select().from(orders);
    expect(allOrders).toHaveLength(0);
    const allCards = await db.select().from(cards);
    expect(allCards.every((c) => c.status === "available")).toBe(true);
  });

  it("订单号冲突后重试，库存仅按成功的订单占用", async () => {
    await seedAutoProduct("retry", 2);
    const input = { email: "buyer@test.dev", items: [{ slug: "retry", quantity: 1 }] };
    const first = await createOrder(input);
    const generate = vi.spyOn(orderNumbers, "generateOrderNo").mockReturnValueOnce(first.orderNo);
    try {
      const second = await createOrder(input);
      expect(second.orderNo).not.toBe(first.orderNo);
      expect(generate).toHaveBeenCalledTimes(2);
      expect(await db.select().from(orders)).toHaveLength(2);
    } finally {
      generate.mockRestore();
    }
  });

  it("部分数量非法时拒绝整单", async () => {
    await seedAutoProduct("invalid-lines", 3);
    for (const quantity of [0, 1.5]) {
      await expect(createOrder({
        email: "buyer@test.dev",
        items: [{ slug: "invalid-lines", quantity: 1 }, { slug: "invalid-lines", quantity }],
      })).rejects.toMatchObject({ code: "INVALID_INPUT" });
    }
    expect(await db.select().from(orders)).toHaveLength(0);
  });

  it("建单时网关已关闭交易，回执保留查单密码和购物车", async () => {
    await seedAutoProduct("already-closed", 1);
    const adapter = vi.spyOn(mockAdapter, "createPayment").mockResolvedValueOnce({
      kind: "closed", providerRef: "closed-transaction", message: "网关已关闭",
    });
    const form = new FormData();
    form.set("email", "buyer@test.dev");
    form.set("items", JSON.stringify([{ slug: "already-closed", quantity: 1 }]));
    try {
      const receipt = await checkoutAction(null, form);
      expect(receipt).toMatchObject({
        ok: true, message: expect.stringContaining("已关闭"),
        data: { purchasedItems: [], queryPassword: expect.any(String), paymentUrl: null },
      });
    } finally {
      adapter.mockRestore();
    }
  });

  it("下架商品不可下单", async () => {
    const { products } = await import("@/db/schema");
    await seedAutoProduct("off1", 3);
    await db.update(products).set({ status: "off" }).where(eq(products.slug, "off1"));
    await expect(
      createOrder({ email: "buyer@test.dev", items: [{ slug: "off1", quantity: 1 }] })
    ).rejects.toThrow(/商品不存在或已下架/);
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
