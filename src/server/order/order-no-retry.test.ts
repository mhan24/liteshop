import { eq } from "drizzle-orm";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { seedAuto } from "./test-helpers";

/**
 * 用 vi.mock 拦截 generateOrderNo（命名导入无法用 vi.spyOn 替换）。
 * 通过 collisionPlan 注入「已存在的订单号」，确定性触发唯一索引冲突，
 * 从而走**真实**的 SAVEPOINT 回滚 + 换号重试路径。
 */
vi.mock("@/lib/order-no", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/order-no")>();
  return {
    ...actual,
    generateOrderNo: (now?: Date, rand?: () => number) => {
      genCalls += 1;
      const forced = collisionPlan(genCalls);
      return forced ?? actual.generateOrderNo(now, rand);
    },
  };
});

/** 第 n 次调用若要触发冲突，返回已存在的订单号；否则 null 表示随机 */
let collisionPlan: (n: number) => string | null = () => null;
let genCalls = 0;

/**
 * 真实重试路径：订单号唯一索引冲突时应换号重试，
 * 且**副作用（库存扣减/占卡）不得累积**。
 *
 * 用 rand 注入让 generateOrderNo 先产出已存在的订单号，确定性复现冲突。
 */

describe("insertOrderWithRetry 真实重试路径", () => {
  beforeEach(() => {
    collisionPlan = () => null;
    genCalls = 0;
  });

  it("manual 订单号冲突：库存只扣一次（SAVEPOINT 回滚副作用）", async () => {
    const { createOrder } = await import("./create-order");
    const { seedManual } = await import("./test-helpers");
    const { products } = await import("@/db/schema");
    const stockOf = () => db.select().from(products).where(eq(products.id, p.id)).get()!.stockLimit;
    const p = seedManual(10);

    // 先建一笔，拿到真实存在的订单号
    genCalls = 0;
    collisionPlan = () => null;
    const first = await createOrder({ email: "collide@test.dev", quantity: 1, slug: p.slug });
    const existingNo = first.orderNo;
    expect(stockOf()).toBe(9); // 占用 1

    // 第二次下单：第一次生成的订单号已存在 → 冲突 → 换号重试
    genCalls = 0;
    collisionPlan = (n) => (n === 1 ? existingNo : null);

    const second = await createOrder({ email: "collide2@test.dev", quantity: 1, slug: p.slug });
    expect(second.orderNo).not.toBe(existingNo);
    expect(genCalls).toBeGreaterThanOrEqual(2);

    // 两笔订单各占 1 份：10 → 8 是正确的（每笔 pending 都真实占用）。
    // 关键是**没有第三份**无谓扣减 —— 若 SAVEPOINT 未回收失败尝试的副作用，
    // 库存会变成 7（多扣一次）。
    expect(stockOf()).toBe(8);

    // 且两笔订单的占用标志一致（没有哪一笔被漏标/多标）
    const both = db
      .select()
      .from(orders)
      .all()
      .filter((o) => o.email === "collide@test.dev" || o.email === "collide2@test.dev");
    expect(both).toHaveLength(2);
    expect(both.every((o) => o.stockCharged === true)).toBe(true);
  });

  it("连续冲突多次后仍能成功（重试上限内）", async () => {
    const { createOrder } = await import("./create-order");
    const p = seedAuto(["C1", "C2", "C3"]);

    genCalls = 0;
    collisionPlan = () => null;
    const first = await createOrder({ email: "multi@test.dev", quantity: 1, slug: p.slug });

    genCalls = 0;
    // 前 3 次都返回已存在的订单号 → 触发 3 次冲突重试
    collisionPlan = (n) => (n <= 3 ? first.orderNo : null);

    const r = await createOrder({ email: "multi2@test.dev", quantity: 1, slug: p.slug });
    expect(r.orderNo).not.toBe(first.orderNo);
    expect(genCalls).toBe(4); // 3 次冲突 + 1 次成功

    // 连续冲突后占卡仍恰好 2 张（无累积、无丢失）
    const { cards } = await import("@/db/schema");
    const bound = db.select().from(cards).all().filter((c) => c.productId === p.id && c.orderId !== null);
    expect(bound).toHaveLength(2);
  });
});
