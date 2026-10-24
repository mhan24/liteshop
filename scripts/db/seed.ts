import { scryptSync, randomBytes } from "node:crypto";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq } from "drizzle-orm";
import { admins, cards, categories, paymentChannels, products } from "../../src/db/schema";

/**
 * 种子数据（开发/演示）：管理员（env 引导）+ 演示分类/商品/卡密 + mock 支付渠道。
 * 幂等：存在即跳过。
 */

function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:16384:8:1:${salt.toString("hex")}:${hash.toString("hex")}`;
}

async function main() {
  const url = process.env.DATABASE_URL ?? "postgres://liteshop:liteshop@localhost:54329/liteshop";
  const pool = new Pool({ connectionString: url, max: 1 });
  const db = drizzle(pool);

  try {
    const adminUser = process.env.ADMIN_USER ?? "admin";
    const adminPass = process.env.ADMIN_PASSWORD ?? "admin12345";
    const existing = await db.select().from(admins).where(eq(admins.username, adminUser)).limit(1);
    if (existing.length === 0) {
      await db.insert(admins).values({ username: adminUser, passwordHash: hashPassword(adminPass) });
      console.log(`[seed] 管理员已创建: ${adminUser} / ${adminPass}（仅开发用）`);
    }

    await db
      .insert(paymentChannels)
      .values({ key: "mock", type: "mock", displayName: "模拟支付（开发）", enabled: true })
      .onConflictDoNothing();

    let catRows = await db.select().from(categories).where(eq(categories.slug, "demo")).limit(1);
    if (catRows.length === 0) {
      catRows = await db
        .insert(categories)
        .values({ slug: "demo", name: "演示分类", description: "种子数据演示", sortOrder: 0 })
        .returning();
    }
    const category = catRows[0]!;

    const demoProducts = [
      { slug: "demo-card-basic", name: "演示卡密 · 基础版", priceCents: 100, count: 10 },
      { slug: "demo-card-pro", name: "演示卡密 · 专业版", priceCents: 500, count: 5 },
    ];
    for (const dp of demoProducts) {
      const rows = await db.select().from(products).where(eq(products.slug, dp.slug)).limit(1);
      let productId = rows[0]?.id;
      if (!productId) {
        const inserted = await db
          .insert(products)
          .values({
            categoryId: category.id,
            slug: dp.slug,
            name: dp.name,
            description: "演示商品：下单支付后自动发放卡密。",
            priceCents: dp.priceCents,
            deliveryType: "auto",
            status: "on",
          })
          .returning({ id: products.id });
        productId = inserted[0]!.id;
      }
      const cardCount = await db.select({ id: cards.id }).from(cards).where(eq(cards.productId, productId)).limit(1);
      if (cardCount.length === 0) {
        await db.insert(cards).values(
          Array.from({ length: dp.count }, (_, i) => ({
            productId: productId!,
            content: `DEMO-${dp.slug.toUpperCase()}-${String(i + 1).padStart(3, "0")}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`,
          }))
        );
      }
    }
    console.log("[seed] 完成");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[seed] 失败:", err);
  process.exit(1);
});
