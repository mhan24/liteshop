import { and, asc, eq, ilike, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, categories, products } from "@/db/schema";
import type { Tx } from "./db-tx";

/**
 * 商品目录与卡密库存。
 *
 * 只有一个库存口径：商品可售数量 = 状态为 available 的卡密数量。
 * 下单即锁卡（reserved），支付确认后转 sold 并写交付记录，关单则退回 available。
 */

export interface ProductView {
  id: number;
  slug: string;
  name: string;
  description: string;
  priceCents: number;
  status: "on" | "off";
  imageUrl: string | null;
  seoDescription: string | null;
  categoryId: number | null;
  categorySlug: string | null;
  categoryName: string | null;
  inStock: boolean;
  /** 可用卡密数量（0 即缺货） */
  stock: number;
}

type CategoryRow = typeof categories.$inferSelect;

function toView(p: typeof products.$inferSelect, cat: CategoryRow | null, stock: number): ProductView {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    description: p.description,
    priceCents: p.priceCents,
    status: p.status,
    imageUrl: p.imageUrl,
    seoDescription: p.seoDescription,
    categoryId: p.categoryId,
    categorySlug: cat?.slug ?? null,
    categoryName: cat?.name ?? null,
    inStock: stock > 0,
    stock,
  };
}

async function availableCards(productId: number): Promise<number> {
  const rows = await db
    .select({ c: sql<number>`count(*)::int` })
    .from(cards)
    .where(and(eq(cards.productId, productId), eq(cards.status, "available")));
  return Number(rows[0]?.c ?? 0);
}

/** 商城在售商品（含实时库存与分类） */
export async function listStoreProducts(filter?: { categorySlug?: string; q?: string }): Promise<ProductView[]> {
  const conditions = [eq(products.status, "on")];
  if (filter?.categorySlug) conditions.push(eq(categories.slug, filter.categorySlug));
  if (filter?.q) {
    const kw = `%${filter.q.replace(/[%_]/g, "")}%`;
    const search = or(ilike(products.name, kw), ilike(products.description, kw));
    if (search) conditions.push(search);
  }
  const rows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(...conditions))
    .orderBy(asc(categories.sortOrder), asc(products.id));

  const out: ProductView[] = [];
  for (const { product: p, category } of rows) {
    out.push(toView(p, category, await availableCards(p.id)));
  }
  return out;
}

export async function listCategories(): Promise<CategoryRow[]> {
  return db.select().from(categories).orderBy(asc(categories.sortOrder), asc(categories.id));
}

export async function getCategoryBySlug(slug: string): Promise<CategoryRow | null> {
  const rows = await db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getProductBySlug(slug: string): Promise<ProductView | null> {
  const rows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .where(and(eq(products.slug, slug), eq(products.status, "on")))
    .limit(1);
  const row = rows[0];
  if (!row) return null;
  return toView(row.product, row.category, await availableCards(row.product.id));
}

/** 管理后台商品列表（含未上架） */
export async function listAllProducts(): Promise<ProductView[]> {
  const rows = await db
    .select({ product: products, category: categories })
    .from(products)
    .leftJoin(categories, eq(products.categoryId, categories.id))
    .orderBy(asc(products.id));
  const out: ProductView[] = [];
  for (const { product: p, category } of rows) {
    out.push(toView(p, category, await availableCards(p.id)));
  }
  return out;
}

/**
 * 下单锁定卡密（必须在事务内调用；任一商品不足即抛错整体回滚）。
 *
 * `FOR UPDATE SKIP LOCKED` 原子占卡并绑定订单 —— 并发订单不会拿到同一张卡，
 * 锁冲突的订单会跳过被锁行、选取其余可用卡，或因不足而失败。
 * 注意：此处不对 products 行加 FOR UPDATE —— order_items 外键会取 KEY SHARE，
 * 两个并发事务同时「KEY SHARE 后升级 FOR UPDATE」会互相死锁（40P01）。
 */
export async function reserveStock(
  tx: Tx,
  orderId: string,
  items: Array<{ productId: number; quantity: number }>
): Promise<void> {
  for (const item of items) {
    const rows = await tx.select().from(products).where(eq(products.id, item.productId)).limit(1);
    const p = rows[0];
    if (!p || p.status !== "on") throw new Error("PRODUCT_NOT_FOUND");

    const claimed = await tx.execute(
      sql`WITH picked AS (
            SELECT id FROM cards
            WHERE product_id = ${p.id} AND status = 'available'
            ORDER BY id
            LIMIT ${item.quantity}
            FOR UPDATE SKIP LOCKED
          )
          UPDATE cards
          SET status = 'reserved', reserved_order_id = ${orderId}
          WHERE id IN (SELECT id FROM picked)
          RETURNING id`
    );
    if (claimed.rows.length < item.quantity) throw new Error("OUT_OF_STOCK");
  }
}

/** 关单/过期：释放该订单占用的全部卡密（幂等） */
export async function releaseStock(tx: Tx, orderId: string): Promise<void> {
  await tx.execute(
    sql`UPDATE cards SET status = 'available', reserved_order_id = NULL
        WHERE reserved_order_id = ${orderId} AND status = 'reserved'`
  );
}

/** 支付确认：reserved → sold（返回交付内容行） */
export async function sellReservedCards(
  tx: Tx,
  orderId: string
): Promise<Array<{ id: number; content: string; productId: number | null }>> {
  return tx
    .update(cards)
    .set({ status: "sold", soldAt: new Date() })
    .where(and(eq(cards.reservedOrderId, orderId), eq(cards.status, "reserved")))
    .returning({ id: cards.id, content: cards.content, productId: cards.productId });
}
