import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { db } from "@/db";
import { cards, orders, products } from "@/db/schema";
import { createOrder } from "./create-order";
import { lookupOrder, getOrderStatusView } from "./query-order";
import { sweepExpiredOrders, expireOrderIfOverdue, countOverduePending } from "./expire-orders";
import { handlePaymentNotify } from "./fulfill-order";
import { buildMockNotifyBody } from "@/server/payment/mock";

/** 超时订单自动关闭：回调丢失时的兜底（防止卡密被永久占用） */

function seedAutoProduct(contents: string[]) {
  const slug = `exp-auto-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "超时测试商品",
      slug,
      description: "d",
      priceCents: 100,
      deliveryType: "auto",
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  for (const c of contents) db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  return { id: p.id, slug };
}

function makeOverdue(orderNo: string) {
  db.update(orders)
    .set({ expirationTime: new Date(Date.now() - 60_000) })
    .where(eq(orders.orderNo, orderNo))
    .run();
}

const getOrder = (no: string) => db.select().from(orders).where(eq(orders.orderNo, no)).get()!;

/** 按商品统计卡密（同文件共享 DB，必须限定 productId 避免跨用例干扰） */
const cardsOf = (productId: number, status: string) =>
  db.select().from(cards).where(and(eq(cards.productId, productId), eq(cards.status, status))).all();

describe("超时订单自动关闭（兜底，防库存泄漏）", () => {
  it("惰性清扫：查单时关闭已超时订单并释放卡密", async () => {
    const p = seedAutoProduct(["C1", "C2"]);
    const r = await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    // 下单即占卡
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);
    makeOverdue(r.orderNo);

    const view = lookupOrder(r.orderNo, "b@test.dev");
    expect(view!.status).toBe("expired");
    // 卡密已释放回可用
    expect(cardsOf(p.id, "reserved")).toHaveLength(0);
    expect(cardsOf(p.id, "available")).toHaveLength(2);
    // 过期后不再暴露继续支付入口
    expect(view!.paymentUrl).toBeNull();
    expect(view!.expiresAtText).toBeNull();
  });

  it("状态轮询路径同样触发清扫", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    makeOverdue(r.orderNo);
    expect(getOrderStatusView(r.orderNo)!.status).toBe("expired");
  });

  it("未超时订单不受影响（不得误关）", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    expect(lookupOrder(r.orderNo, "b@test.dev")!.status).toBe("pending");
    expect(cardsOf(p.id, "reserved")).toHaveLength(1);
  });

  it("无有效期的订单不被清扫（避免误关）", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    db.update(orders).set({ expirationTime: null }).where(eq(orders.orderNo, r.orderNo)).run();
    expect(expireOrderIfOverdue(r.orderNo)).toBe(false);
    expect(getOrder(r.orderNo).status).toBe("pending");
  });

  it("批量清扫处理全部超时订单并返回单号", async () => {
    const p = seedAutoProduct(["C1", "C2", "C3"]);
    const a = await createOrder({ email: "a@test.dev", quantity: 1, slug: p.slug });
    const b = await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    const before = cardsOf(p.id, "available").length;
    makeOverdue(a.orderNo);
    makeOverdue(b.orderNo);

    const res = sweepExpiredOrders();
    expect(res.expired).toBe(2);
    expect(res.orderNos.sort()).toEqual([a.orderNo, b.orderNo].sort());
    expect(countOverduePending()).toBe(0);
    // 两笔订单占用的卡密均已释放回可用池
    expect(cardsOf(p.id, "available")).toHaveLength(before + 2);
  });

  it("已支付订单即使过期也不会被清扫（不得把已付款订单关掉）", async () => {
    const p = seedAutoProduct(["C1"]);
    const r = await createOrder({ email: "b@test.dev", quantity: 1, slug: p.slug });
    const o = getOrder(r.orderNo);
    handlePaymentNotify(
      "mock",
      buildMockNotifyBody({
        orderNo: r.orderNo,
        tradeId: o.tradeId!,
        amountCents: BigInt(o.totalCents),
        status: 2,
      })
    );
    expect(getOrder(r.orderNo).status).toBe("completed");

    // 即便把有效期改到过去，也不得改变已完成订单
    makeOverdue(r.orderNo);
    expect(expireOrderIfOverdue(r.orderNo)).toBe(false);
    expect(sweepExpiredOrders().expired).toBe(0);
    expect(getOrder(r.orderNo).status).toBe("completed");
  });
});

describe("日志保留策略（回调端点未认证，需限制增长）", () => {
  it("purgeOldLogs 删除超期 notify_logs，保留窗口内记录", async () => {
    const { purgeOldLogs } = await import("./expire-orders");
    const { notifyLogs } = await import("@/db/schema");

    const old = new Date(Date.now() - 40 * 86400_000); // 40 天前（超 30 天窗口）
    const recent = new Date(Date.now() - 1 * 86400_000); // 1 天前

    db.insert(notifyLogs).values({ provider: "bepusdt", payloadHash: "old-hash-1", payload: "x", createdAt: old }).run();
    db.insert(notifyLogs).values({ provider: "bepusdt", payloadHash: "new-hash-1", payload: "y", createdAt: recent }).run();

    const before = db.select().from(notifyLogs).all().length;
    const res = purgeOldLogs();

    expect(res.notifyLogsDeleted).toBeGreaterThanOrEqual(1);
    const after = db.select().from(notifyLogs).all();
    expect(after.length).toBe(before - res.notifyLogsDeleted);
    // 近期记录必须保留
    expect(after.some((r) => r.payloadHash === "new-hash-1")).toBe(true);
    expect(after.some((r) => r.payloadHash === "old-hash-1")).toBe(false);
  });
});
