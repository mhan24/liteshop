import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/db";
import { cards, orders, paymentAttempts, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { handlePaymentNotify } from "./fulfill-order";
import { buildMockNotifyBody } from "@/server/payment/mock";

/**
 * 支付创建与回调的请求交错（审计 P1）。
 *
 * 场景：调用网关创建交易后、本地尚未写回 trade_id 快照期间，
 * 网关就推送了成功回调。若写回不加防护，会把已完成的订单改回待支付，
 * 并留下一条 pending 的支付尝试 → 订单已完成但支付尝试显示待支付。
 */

function seedAuto(contents: string[]) {
  const slug = `race-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({ name: "竞态商品", slug, description: "d", priceCents: 500, deliveryType: "auto", status: "on" })
    .returning({ id: products.id })
    .get()!;
  for (const c of contents) db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  return { id: p.id, slug };
}

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

afterEach(() => vi.unstubAllGlobals());

describe("创建支付与回调交错", () => {
  it("回调先完成订单 → 写回不得把订单改回 pending，也不得留下 pending 尝试", async () => {
    const p = seedAuto(["C1"]);
    let orderNoCreated = "";

    // 用 mock 驱动（测试环境默认），但拦截 provider.createPayment
    // 在它"返回"之前插入一次成功回调，精确复现交错时刻。
    const attemptsMod = await import("@/server/payment/attempts");
    const paymentMod = await import("@/server/payment");

    const realResolver = paymentMod.resolvePaymentProvider;
    const spy = vi.spyOn(paymentMod, "resolvePaymentProvider").mockImplementation(() => {
      const real = realResolver();
      return {
        ...real,
        createPayment: async (input: Parameters<typeof real.createPayment>[0]) => {
          const created = await real.createPayment(input);
          // 此刻本地订单已建、但快照尚未写回 —— 正是审计指出的窗口
          orderNoCreated = input.orderNo;
          handlePaymentNotify(
            "mock",
            buildMockNotifyBody({
              orderNo: input.orderNo,
              tradeId: created.tradeId!,
              amountCents: input.amountCents,
              currency: input.currency,
              status: 2,
            })
          );
          return created;
        },
      };
    });

    try {
      await createOrder({ email: "race@test.dev", quantity: 1, slug: p.slug });
    } finally {
      spy.mockRestore();
    }
    expect(orderNoCreated).not.toBe("");
    void attemptsMod;

    const o = getOrder(orderNoCreated);
    // 订单已由回调完成
    expect(o.status).toBe("completed");
    // 关键：不得被写回改成 pending
    expect(o.status).not.toBe("pending");

    // 支付尝试不得出现「订单已完成但尝试仍是 pending」的不一致
    const attempts = db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderNo, orderNoCreated))
      .all();
    const pendingAttempts = attempts.filter((a) => a.status === "pending");
    expect(pendingAttempts).toHaveLength(0);
  });

  it("正常路径（无回调交错）仍会写入 trade_id 与支付尝试", async () => {
    const p = seedAuto(["C1"]);
    const r = await createOrder({ email: "normal@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    expect(o.tradeId).toBeTruthy();
    const attempts = db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderNo, r.orderNo))
      .all();
    expect(attempts.length).toBeGreaterThanOrEqual(1);
  });
});
