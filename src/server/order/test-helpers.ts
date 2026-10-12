import { db } from "@/db";
import { cards, products } from "@/db/schema";

/** 测试辅助：建一个自动发卡商品并预置卡密 */
export function seedAuto(contents: string[], priceCents = 100) {
  const slug = `rp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "重购测试",
      slug,
      description: "d",
      priceCents,
      deliveryType: "auto",
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  for (const c of contents) {
    db.insert(cards).values({ productId: p.id, content: c, status: "available" }).run();
  }
  return { id: p.id, slug };
}

/** 测试辅助：建一个有限库存的人工发货商品 */
export function seedManual(stockLimit: number, priceCents = 100) {
  const slug = `man-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const p = db
    .insert(products)
    .values({
      name: "人工商品",
      slug,
      description: "d",
      priceCents,
      deliveryType: "manual",
      stockLimit,
      status: "on",
    })
    .returning({ id: products.id })
    .get()!;
  return { id: p.id, slug };
}
