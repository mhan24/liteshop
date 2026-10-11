import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, orders, products } from "@/db/schema";
import type { NewProduct, Product } from "@/db/schema";
import { toCents } from "@/lib/money";
import { slugify } from "@/lib/slug";

/** 后台·商品服务（service 层；写操作全部记录审计日志由 Action 层调用） */

export interface ProductListRow extends Product {
  availableCards: number;
  soldCards: number;
  orderCount: number;
}

export function listProducts(): ProductListRow[] {
  const rows = db.select().from(products).orderBy(desc(products.sort), desc(products.id)).all();
  const cardStats = db
    .select({
      productId: cards.productId,
      status: cards.status,
      n: sql<number>`count(*)`,
    })
    .from(cards)
    .groupBy(cards.productId, cards.status)
    .all();
  const orderStats = db
    .select({ productId: orders.productId, n: sql<number>`count(*)` })
    .from(orders)
    .groupBy(orders.productId)
    .all();

  return rows.map((p) => ({
    ...p,
    availableCards:
      cardStats.find((c) => c.productId === p.id && c.status === "available")?.n ?? 0,
    soldCards: cardStats.find((c) => c.productId === p.id && c.status === "sold")?.n ?? 0,
    orderCount: orderStats.find((o) => o.productId === p.id)?.n ?? 0,
  }));
}

export function getProductBySlug(slug: string): Product | undefined {
  return db.select().from(products).where(eq(products.slug, slug)).get();
}

export interface ProductInput {
  name: string;
  slug?: string;
  description: string;
  imageUrl: string;
  priceCentsText: string;
  deliveryType: string;
  stockLimit: number;
  status: string;
  sort: number;
}

function validateProductInput(input: ProductInput): { ok: true; data: Omit<NewProduct, "slug"> & { slug: string } } | { ok: false; message: string } {
  const name = input.name.trim();
  if (!name || name.length > 100) return { ok: false, message: "商品名必填且不超过 100 字" };
  const price = toCents(input.priceCentsText.trim());
  if (price <= 0n) return { ok: false, message: "价格必须大于 0" };
  if (Number(price) > 90_000_000_000) return { ok: false, message: "价格过大" };
  const deliveryType = input.deliveryType === "manual" ? "manual" : "auto";
  const stockLimit = Math.trunc(input.stockLimit) || 0;
  if (stockLimit < 0) return { ok: false, message: "库存不能为负" };
  const status = input.status === "off" ? "off" : "on";
  const sort = Math.trunc(input.sort) || 0;
  const slug = slugify(input.slug?.trim() || name);
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    return { ok: false, message: "标识仅限小写字母、数字、连字符（1-80 位）" };
  }
  return {
    ok: true,
    data: {
      name,
      slug,
      description: input.description.trim().slice(0, 5000),
      imageUrl: input.imageUrl.trim() || null,
      priceCents: Number(price),
      deliveryType,
      stockLimit,
      status,
      sort,
    },
  };
}

export function createProduct(input: ProductInput): { ok: boolean; message: string } {
  const v = validateProductInput(input);
  if (!v.ok) return v;
  const dup = db.select({ id: products.id }).from(products).where(eq(products.slug, v.data.slug)).get();
  if (dup) return { ok: false, message: `标识已被占用: ${v.data.slug}` };
  db.insert(products).values(v.data).run();
  return { ok: true, message: "商品已创建" };
}

export function updateProduct(id: number, input: ProductInput): { ok: boolean; message: string } {
  const v = validateProductInput(input);
  if (!v.ok) return v;
  const existing = db.select().from(products).where(eq(products.id, id)).get();
  if (!existing) return { ok: false, message: "商品不存在" };
  const dup = db
    .select({ id: products.id })
    .from(products)
    .where(and(eq(products.slug, v.data.slug), sql`${products.id} != ${id}`))
    .get();
  if (dup) return { ok: false, message: `标识已被占用: ${v.data.slug}` };

  // manual 库存上限：允许向上调整或改为不限；向下不允许低于已售占用（简化：直接更新，发货侧不回看上限）
  db.update(products)
    .set({ ...v.data, updatedAt: new Date() })
    .where(eq(products.id, id))
    .run();
  return { ok: true, message: "商品已更新" };
}

/** 下架（软删，交易数据保留）；存在订单时禁止硬删 */
export function setProductStatus(id: number, status: "on" | "off"): void {
  db.update(products).set({ status, updatedAt: new Date() }).where(eq(products.id, id)).run();
}

export function deleteProduct(id: number): { ok: boolean; message: string } {
  const referenced = db.select({ id: orders.id }).from(orders).where(eq(orders.productId, id)).get();
  if (referenced) {
    return { ok: false, message: "该商品已有订单关联，禁止删除（可下架）" };
  }
  const reserved = db
    .select({ id: cards.id })
    .from(cards)
    .where(and(eq(cards.productId, id), inArray(cards.status, ["reserved", "sold"])))
    .get();
  if (reserved) {
    return { ok: false, message: "该商品卡密有占用/售出记录，禁止删除（可下架）" };
  }
  db.transaction((tx) => {
    tx.delete(cards).where(eq(cards.productId, id)).run();
    tx.delete(products).where(eq(products.id, id)).run();
  });
  return { ok: true, message: "商品已删除" };
}

/* ===== 卡密管理 ===== */

export interface ImportCardsResult {
  imported: number;
  duplicates: number;
  invalid: number;
  message: string;
}

/** 批量导入卡密：一行一个；代码去重 + DB UNIQUE(product_id, content) 双保险（PLAN §3） */
export function importCards(productId: number, raw: string): ImportCardsResult {
  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return { imported: 0, duplicates: 0, invalid: 0, message: "商品不存在" };
  if (product.deliveryType !== "auto") {
    return { imported: 0, duplicates: 0, invalid: 0, message: "仅自动发卡商品需要卡密" };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const valid = lines.filter((l) => l.length <= 500);
  const invalid = lines.length - valid.length;
  const unique = Array.from(new Set(valid));
  const duplicatesInBatch = valid.length - unique.length;

  let imported = 0;
  let duplicates = duplicatesInBatch;
  for (const content of unique) {
    try {
      db.insert(cards).values({ productId, content, status: "available" }).run();
      imported += 1;
    } catch {
      // UNIQUE(product_id, content) 冲突 → 与库中已有重复
      duplicates += 1;
    }
  }
  return {
    imported,
    duplicates,
    invalid,
    message: `导入 ${imported} 张，重复 ${duplicates} 张，无效 ${invalid} 行`,
  };
}

export interface CardRow {
  id: number;
  content: string;
  status: string;
  orderId: string | null;
  soldAt: Date | null;
  createdAt: Date;
}

export function listCards(productId: number, status: string | null, limit = 200): CardRow[] {
  const conds = [eq(cards.productId, productId)];
  if (status === "available" || status === "reserved" || status === "sold") {
    conds.push(eq(cards.status, status));
  }
  return db
    .select({
      id: cards.id,
      content: cards.content,
      status: cards.status,
      orderId: cards.orderId,
      soldAt: cards.soldAt,
      createdAt: cards.createdAt,
    })
    .from(cards)
    .where(and(...conds))
    .orderBy(desc(cards.id))
    .limit(limit)
    .all();
}

/** 删除未使用卡密（available）；reserved/sold 保留（禁止硬删除已产生交易关联的数据） */
export function deleteAvailableCards(productId: number, ids: number[]): number {
  if (ids.length === 0) return 0;
  return db
    .delete(cards)
    .where(and(eq(cards.productId, productId), eq(cards.status, "available"), inArray(cards.id, ids)))
    .run().changes;
}

export function clearAvailableCards(productId: number): number {
  return db
    .delete(cards)
    .where(and(eq(cards.productId, productId), eq(cards.status, "available")))
    .run().changes;
}

/* ===== 仪表盘 ===== */

export interface DashboardStats {
  todayOrders: number;
  todayRevenueCents: number;
  totalOrders: number;
  totalRevenueCents: number;
  pendingManual: number; // paid（待人工发货）
  delivering: number;
  lowStockProducts: { id: number; name: string; slug: string; availableCards: number }[];
}

export function getDashboardStats(threshold: number): DashboardStats {
  const dayStart = new Date();
  dayStart.setHours(0, 0, 0, 0);

  const revenueRow = (from?: Date) =>
    db
      .select({
        n: sql<number>`count(*)`,
        sum: sql<number>`coalesce(sum(${orders.totalCents}), 0)`,
      })
      .from(orders)
      .where(
        from
          ? and(inArray(orders.status, ["paid", "delivering", "completed"]), gte(orders.paidAt, from))
          : inArray(orders.status, ["paid", "delivering", "completed"])
      )
      .get()!;

  const today = revenueRow(dayStart);
  const total = revenueRow();

  const statusCount = (status: string) =>
    db.select({ n: sql<number>`count(*)` }).from(orders).where(eq(orders.status, status)).get()?.n ?? 0;

  const autoProducts = db.select().from(products).where(and(eq(products.deliveryType, "auto"), eq(products.status, "on"))).all();
  const lowStock: DashboardStats["lowStockProducts"] = [];
  for (const p of autoProducts) {
    const n =
      db
        .select({ n: sql<number>`count(*)` })
        .from(cards)
        .where(and(eq(cards.productId, p.id), eq(cards.status, "available")))
        .get()?.n ?? 0;
    if (n <= threshold) lowStock.push({ id: p.id, name: p.name, slug: p.slug, availableCards: n });
  }

  return {
    todayOrders: today.n,
    todayRevenueCents: today.sum,
    totalOrders: total.n,
    totalRevenueCents: total.sum,
    pendingManual: statusCount("paid"),
    delivering: statusCount("delivering"),
    lowStockProducts: lowStock,
  };
}

/** 订单列表（后台）：状态筛选 + 关键字（订单号/邮箱） */
export interface AdminOrderRow {
  id: number;
  orderNo: string;
  productName: string;
  quantity: number;
  totalCents: number;
  currency: string;
  email: string;
  status: string;
  deliveryType: string;
  deliveryContent: string | null;
  tradeId: string | null;
  createdAt: Date;
  paidAt: Date | null;
  note: string | null;
}

export function listOrdersForAdmin(opts: {
  status?: string;
  q?: string;
  limit?: number;
}): AdminOrderRow[] {
  const limit = Math.min(opts.limit ?? 100, 500);
  const conds = [];
  if (opts.status && ["pending", "paid", "delivering", "completed", "expired", "closed"].includes(opts.status)) {
    conds.push(eq(orders.status, opts.status));
  }
  const q = opts.q?.trim();
  if (q) {
    conds.push(sql`(${orders.orderNo} LIKE ${"%" + q + "%"} OR lower(${orders.email}) LIKE ${"%" + q.toLowerCase() + "%"})`);
  }
  const rows = db
    .select({
      id: orders.id,
      orderNo: orders.orderNo,
      productName: orders.productName,
      quantity: orders.quantity,
      totalCents: orders.totalCents,
      currency: orders.currency,
      email: orders.email,
      status: orders.status,
      deliveryType: products.deliveryType,
      deliveryContent: orders.deliveryContent,
      tradeId: orders.tradeId,
      createdAt: orders.createdAt,
      paidAt: orders.paidAt,
      note: orders.note,
    })
    .from(orders)
    .leftJoin(products, eq(orders.productId, products.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(orders.id))
    .limit(limit)
    .all();
  return rows.map((r) => ({ ...r, deliveryType: r.deliveryType ?? "auto" }));
}
