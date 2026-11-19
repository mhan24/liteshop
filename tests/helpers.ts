import { sql } from "drizzle-orm";
import { db } from "@/db";
import { orders, payments } from "@/db/schema";
import { buildMockNotifyBody } from "@/server/payments/mock";
import { handlePaymentWebhook } from "@/server/orders";
import { invalidateConfig } from "@/server/settings";

/** 清空业务表（保留结构）；每个集成测试用例前调用，保证用例独立 */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      notify_logs, deliveries, payments, order_items, orders,
      cards, products, categories,
      audit_logs, app_config, admins, notifications
    RESTART IDENTITY CASCADE
  `);
  invalidateConfig();
}

/** 造一个卡密商品 + N 张卡密，返回商品 id 与卡密内容 */
export async function seedAutoProduct(
  slug: string,
  cardCount: number,
  priceCents = 100
): Promise<{ productId: number; contents: string[] }> {
  const { products, cards } = await import("@/db/schema");
  const inserted = await db
    .insert(products)
    .values({
      slug,
      name: `测试商品 ${slug}`,
      description: "测试商品",
      priceCents,
      status: "on",
    })
    .returning({ id: products.id });
  const productId = inserted[0]!.id;
  const contents = Array.from({ length: cardCount }, (_, i) => `CARD-${slug}-${i.toString().padStart(3, "0")}`);
  await db.insert(cards).values(contents.map((content) => ({ productId, content })));
  return { productId, contents };
}

/** 取订单与其当前支付记录 */
export async function orderWithPayment(orderNo: string) {
  const orderRows = await db.select().from(orders).where(sql`${orders.orderNo} = ${orderNo}`).limit(1);
  const order = orderRows[0]!;
  const payRows = await db.select().from(payments).where(sql`${payments.orderId} = ${order.id}`);
  return { order, payment: payRows[0]! };
}

/** 走完整 mock 回调，把订单推进到 completed */
export async function payOrderWithMock(orderNo: string): Promise<void> {
  const { order, payment } = await orderWithPayment(orderNo);
  const result = await handlePaymentWebhook(
    "mock",
    buildMockNotifyBody({
      orderNo,
      providerRef: payment.providerRef!,
      amountCents: order.totalCents,
      status: 2,
    })
  );
  if (!result.handled) throw new Error(`支付回调未处理: ${result.message}`);
}
