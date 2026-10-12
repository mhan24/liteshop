import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, orders, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { handlePaymentNotify } from "./fulfill-order";
import { buildMockNotifyBody } from "@/server/payment/mock";

/** 并发/幂等：确保不会重复发货、不会超卖 */

function seedAuto(contents: string[]) {
  const slug = `conc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({ name: "并发测试", slug, description: "d", priceCents: 100, deliveryType: "auto", status: "on" })
    .returning({ id: products.id })
    .get()!;
  for (const c of contents) db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  return { id: p.id, slug };
}

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

/** 按商品统计指定状态的卡密（测试同文件共享 DB，必须限定 productId） */
const cardsOf = (productId: number, status: string) =>
  db.select().from(cards).where(and(eq(cards.productId, productId), eq(cards.status, status))).all();

describe("回调幂等：同一报文重复投递", () => {
  it("完全相同报文投递多次只发货一次（同 hash 去重）", async () => {
    const p = seedAuto(["C1", "C2"]);
    const r = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const body = buildMockNotifyBody({
      orderNo: r.orderNo,
      tradeId: getOrder(r.orderNo).tradeId!,
      amountCents: BigInt(getOrder(r.orderNo).totalCents),
      status: 2,
    });

    const results = [0, 1, 2, 3].map(() => handlePaymentNotify("mock", body));
    // 首次处理，其余识别为重复
    expect(results.filter((x) => x.message.includes("自动发货完成")).length).toBe(1);
    expect(results.filter((x) => x.message.includes("重复")).length).toBe(3);

    const o = getOrder(r.orderNo);
    expect(o.status).toBe("completed");
    expect(o.deliveryContent).toBe("C1");
    // 只卖出 1 张（按商品限定，避免受同文件其他用例影响）
    expect(cardsOf(p.id, "sold")).toHaveLength(1);
    expect(cardsOf(p.id, "available")).toHaveLength(1);
  });

  it("不同 payload_hash 但同一订单的重复成功回调不重复发货", async () => {
    const p = seedAuto(["C1", "C2", "C3"]);
    const r = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    const base = {
      orderNo: r.orderNo,
      tradeId: o.tradeId!,
      amountCents: BigInt(o.totalCents),
      status: 2 as const,
    };
    // 两次内容不同（block_transaction_id 随机）→ hash 不同 → 绕过 hash 去重
    handlePaymentNotify("mock", buildMockNotifyBody(base));
    handlePaymentNotify("mock", buildMockNotifyBody(base));

    expect(getOrder(r.orderNo).status).toBe("completed");
    // 关键：仍然只卖出 1 张卡
    expect(cardsOf(p.id, "sold")).toHaveLength(1);
    expect(cardsOf(p.id, "available")).toHaveLength(2);
  });

  it("已完成订单收到超时回调不改变状态", async () => {
    const p = seedAuto(["C1"]);
    const r = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    handlePaymentNotify("mock", buildMockNotifyBody({ orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents), status: 2 }));
    expect(getOrder(r.orderNo).status).toBe("completed");

    handlePaymentNotify("mock", buildMockNotifyBody({ orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents), status: 3 }));
    expect(getOrder(r.orderNo).status).toBe("completed");
  });

  it("金额不符的回调不发货（防篡改）", async () => {
    const p = seedAuto(["C1"]);
    const r = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: o.tradeId!, amountCents: BigInt(o.totalCents) - 1n, status: 2,
    }));
    expect(res.handled).toBe(false);
    expect(getOrder(r.orderNo).status).toBe("pending");
    expect(cardsOf(p.id, "sold")).toHaveLength(0);
  });

  it("trade_id 不符的回调不发货", async () => {
    const p = seedAuto(["C1"]);
    const r = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    const res = handlePaymentNotify("mock", buildMockNotifyBody({
      orderNo: r.orderNo, tradeId: "forged", amountCents: BigInt(o.totalCents), status: 2,
    }));
    expect(res.handled).toBe(false);
    expect(getOrder(r.orderNo).status).toBe("pending");
  });
});

describe("库存并发：不超卖", () => {
  it("卡池 3 张，5 笔并发下单，只有 3 笔成功且不超卖", async () => {
    const p = seedAuto(["C1", "C2", "C3"]);
    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) =>
        createOrder({ email: `u${i}@test.dev`, quantity: 1, slug: p.slug })
      )
    );
    const ok = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(3);
    expect(failed).toHaveLength(2);

    // 恰好 3 张被占用，无超卖
    expect(cardsOf(p.id, "reserved")).toHaveLength(3);
    expect(cardsOf(p.id, "available")).toHaveLength(0);
  });

  it("manual 库存 2 件，5 笔并发下单只成功 2 笔", async () => {
    const slug = `conc-m-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const p = db.insert(products).values({
      name: "并发manual", slug, description: "d", priceCents: 100,
      deliveryType: "manual", stockLimit: 2, status: "on",
    }).returning({ id: products.id }).get()!;

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, (_, i) => createOrder({ email: `m${i}@test.dev`, quantity: 1, slug }))
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    // 剩余 0，且不为负
    const after = db.select().from(products).where(eq(products.id, p.id)).get()!;
    expect(after.stockLimit).toBe(0);
  });
});
