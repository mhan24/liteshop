import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, products } from "@/db/schema";
import { formatMoney } from "@/lib/money";
import { visibleStock, isOnSaleByStock } from "@/lib/stock";

/** 前台商品视图（只读；仅上架商品） */

export interface ShopProductCard {
  id: number;
  name: string;
  slug: string;
  description: string;
  imageUrl: string | null;
  priceFormatted: string;
  currency: string;
  deliveryType: string;
  /** 可售余量：auto = 卡池可用数；manual = 剩余数量（null 表示不限） */
  stock: number | null;
  onSale: boolean;
}

export function listShopProducts(): ShopProductCard[] {
  const rows = db
    .select()
    .from(products)
    .where(eq(products.status, "on"))
    .orderBy(desc(products.sort), desc(products.id))
    .all();

  const cardCounts = db
    .select({ productId: cards.productId, n: sql<number>`count(*)` })
    .from(cards)
    .where(eq(cards.status, "available"))
    .groupBy(cards.productId)
    .all();

  return rows.map((p) => {
    let stock: number | null = null;
    if (p.deliveryType === "auto") {
      stock = cardCounts.find((c) => c.productId === p.id)?.n ?? 0;
    } else {
      stock = visibleStock(p.stockLimit);
    }
    // auto：卡池有货即可售；manual：不限库存或仍有余额即可售（0 = 售罄）
    const onSale = p.deliveryType === "manual" ? isOnSaleByStock(p.stockLimit) : (stock ?? 0) > 0;
    return {
      id: p.id,
      name: p.name,
      slug: p.slug,
      description: p.description,
      imageUrl: p.imageUrl,
      priceFormatted: formatMoney(BigInt(p.priceCents), p.currency),
      currency: p.currency,
      deliveryType: p.deliveryType,
      stock,
      onSale,
    };
  });
}

export function getShopProduct(slug: string): ShopProductCard | undefined {
  const p = db
    .select()
    .from(products)
    .where(and(eq(products.slug, slug), eq(products.status, "on")))
    .get();
  if (!p) return undefined;
  let stock: number | null = null;
  if (p.deliveryType === "auto") {
    stock =
      db
        .select({ n: sql<number>`count(*)` })
        .from(cards)
        .where(and(eq(cards.productId, p.id), eq(cards.status, "available")))
        .get()?.n ?? 0;
  } else {
    stock = visibleStock(p.stockLimit);
  }
  const onSale = p.deliveryType === "manual" ? isOnSaleByStock(p.stockLimit) : (stock ?? 0) > 0;
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    description: p.description,
    imageUrl: p.imageUrl,
    priceFormatted: formatMoney(BigInt(p.priceCents), p.currency),
    currency: p.currency,
    deliveryType: p.deliveryType,
    stock,
    onSale,
  };
}
