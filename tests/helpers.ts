import { sql } from "drizzle-orm";
import { db } from "@/db";
import { paymentChannels } from "@/db/schema";

/** 清空业务表（保留结构）；每个集成测试用例前调用，保证用例独立 */
export async function resetDb(): Promise<void> {
  await db.execute(sql`
    TRUNCATE TABLE
      notify_logs, deliveries, payments, order_items, orders,
      cards, products, categories, payment_channels,
      audit_logs, settings, admins
    RESTART IDENTITY CASCADE
  `);
  // mock 渠道（payments.channel_id 外键需要真实行）
  await db
    .insert(paymentChannels)
    .values({ key: "mock", type: "mock", displayName: "模拟支付（开发）", enabled: true })
    .onConflictDoNothing();
}

/** 造一个自动发卡商品 + N 张卡密，返回商品 id 与卡密内容 */
export async function seedAutoProduct(slug: string, cardCount: number, priceCents = 100): Promise<{ productId: number; contents: string[] }> {
  const { products, cards } = await import("@/db/schema");
  const inserted = await db
    .insert(products)
    .values({
      slug,
      name: `测试商品 ${slug}`,
      description: "测试商品",
      priceCents,
      deliveryType: "auto",
      status: "on",
    })
    .returning({ id: products.id });
  const productId = inserted[0]!.id;
  const contents = Array.from({ length: cardCount }, (_, i) => `CARD-${slug}-${i.toString().padStart(3, "0")}`);
  await db.insert(cards).values(contents.map((content) => ({ productId, content })));
  return { productId, contents };
}

/** 造一个 manual 商品（有限库存） */
export async function seedManualProduct(slug: string, stockLimit: number | null, priceCents = 100): Promise<number> {
  const { products } = await import("@/db/schema");
  const inserted = await db
    .insert(products)
    .values({
      slug,
      name: `测试商品 ${slug}`,
      description: "测试商品",
      priceCents,
      deliveryType: "manual",
      stockLimit,
      status: "on",
    })
    .returning({ id: products.id });
  return inserted[0]!.id;
}

/** 站点币种设置为 USD（测试订单默认走 USD） */
export async function seedCurrency(currency = "USD"): Promise<void> {
  const { setSetting, SETTING_KEYS } = await import("@/server/settings");
  await setSetting(SETTING_KEYS.currency, currency);
}
