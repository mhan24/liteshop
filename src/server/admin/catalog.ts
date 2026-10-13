import { and, desc, eq, gte, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { cards, orders, paymentAnomalies, products } from "@/db/schema";
import type { NewProduct, Product } from "@/db/schema";
import { SUPPORTED_CURRENCIES, toMinorUnits, isZeroDecimalCurrency } from "@/lib/money";
import { getSiteCurrency } from "@/server/settings";
import { isUnlimitedStock, normalizeStockLimit, STOCK_UNLIMITED } from "@/lib/stock";
import { slugify } from "@/lib/slug";

/** 后台·商品服务（service 层；写操作全部记录审计日志由 Action 层调用） */

/**
 * 转义 LIKE 模式中的元字符，使其按字面量匹配。
 * 顺序很重要：必须先转义反斜杠本身，否则会二次转义。
 */
function escapeLike(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

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
  /** 编辑场景下商品的原币种：币种留空时用它解析价格，避免与站点默认币种精度不一致 */
  existingCurrency?: string;
  slug?: string;
  description: string;
  imageUrl: string;
  priceCentsText: string;
  currency?: string;
  deliveryType: string;
  stockLimit: number;
  status: string;
  sort: number;
}

export function validateProductInput(input: ProductInput): { ok: true; data: Omit<NewProduct, "slug"> & { slug: string } } | { ok: false; message: string } {
  const name = input.name.trim();
  if (!name || name.length > 100) return { ok: false, message: "商品名必填且不超过 100 字" };
  // toCents 对非法输入抛 MoneyParseError：此处必须捕获并转为可读校验错误，
  // 否则后台填错价格会让 Server Action 直接抛未处理异常（整页 500）。
  // 币种需先确定，才能按对应「最小单位」解析价格（JPY 无小数）。
  //
  // 编辑已有商品时表单可能留空币种（表示"保持原值"），此时**必须用商品原币种**
  // 解析价格，而不是站点默认币种：若商品是 JPY 而站点默认 USD，
  // 用 USD 解析会把「1500 日元」误存为 150000（放大 100 倍）。
  const rawCurrency = (input.currency ?? "").trim().toUpperCase();
  const effectiveCurrency =
    rawCurrency !== "" && (SUPPORTED_CURRENCIES as readonly string[]).includes(rawCurrency)
      ? rawCurrency
      : (input.existingCurrency?.trim().toUpperCase() || getSiteCurrency());
  let price: bigint;
  try {
    price = toMinorUnits(input.priceCentsText.trim(), effectiveCurrency);
  } catch {
    return {
      ok: false,
      message: isZeroDecimalCurrency(effectiveCurrency)
        ? `${effectiveCurrency} 为无小数币种，请填写整数金额（如 1500）`
        : "价格格式不正确，请填写如 9.90 的数字",
    };
  }
  if (price <= 0n) return { ok: false, message: "价格必须大于 0" };
  if (Number(price) > 90_000_000_000) return { ok: false, message: "价格过大" };
  const deliveryType = input.deliveryType === "manual" ? "manual" : "auto";
  // 库存：-1 = 不限；>= 0 = 有限（0 明确表示售罄）。
  // 空/非法输入按"不限"处理（与表单留空语义一致）。
  const stockLimit = normalizeStockLimit(input.stockLimit);
  const status = input.status === "off" ? "off" : "on";
  const sort = Math.trunc(input.sort) || 0;
  const slug = slugify(input.slug?.trim() || name);
  if (!/^[a-z0-9-]{1,80}$/.test(slug)) {
    return { ok: false, message: "标识仅限小写字母、数字、连字符（1-80 位）" };
  }
  // 币种：新建跟随站点默认；编辑时留空保持原值（由调用方处理）
  const currency = (input.currency ?? "").trim().toUpperCase();
  if (currency !== "" && !(SUPPORTED_CURRENCIES as readonly string[]).includes(currency)) {
    return { ok: false, message: `不支持的币种: ${currency}` };
  }
  return {
    ok: true,
    data: {
      name,
      slug,
      description: input.description.trim().slice(0, 5000),
      imageUrl: input.imageUrl.trim() || null,
      priceCents: Number(price),
      currency: currency || getSiteCurrency(),
      deliveryType,
      stockLimit,
      status,
      sort,
    },
  };
}

export function createProduct(input: ProductInput): { ok: boolean; message: string } {
  const v = validateProductInput({ ...input, currency: input.currency ?? getSiteCurrency() });
  if (!v.ok) return v;
  const dup = db.select({ id: products.id }).from(products).where(eq(products.slug, v.data.slug)).get();
  if (dup) return { ok: false, message: `标识已被占用: ${v.data.slug}` };
  db.insert(products).values(v.data).run();
  return { ok: true, message: "商品已创建" };
}

export function updateProduct(id: number, input: ProductInput): { ok: boolean; message: string } {
  return db.transaction((tx) => {
    // 必须先取出原商品，才能在其币种留空时用原币种解析价格
    const existing = tx.select().from(products).where(eq(products.id, id)).get();
    if (!existing) return { ok: false, message: "商品不存在" };
    const v = validateProductInput({ ...input, existingCurrency: existing.currency });
    if (!v.ok) return v;
    const dup = tx
      .select({ id: products.id })
      .from(products)
      .where(and(eq(products.slug, v.data.slug), sql`${products.id} != ${id}`))
      .get();
    if (dup) return { ok: false, message: `标识已被占用: ${v.data.slug}` };

    // 检测「有限库存 ↔ 不限库存」的模式切换。
    // validateProductInput 已通过 normalizeStockLimit 保证 stockLimit 为数字
    const nextStockLimit = v.data.stockLimit ?? STOCK_UNLIMITED;
    const modeChanged =
      isUnlimitedStock(existing.stockLimit) !== isUnlimitedStock(nextStockLimit);

    // 模式切换守卫：存在未结束的人工订单时**禁止**切换库存模式。
    //
    // 早期做法是在切换时清除旧订单的 stockCharged，但那只是把问题转移：
    // 旧订单仍然有效、仍可能付款并要求交付，库存系统却不再承认其占用，
    // 于是切回有限库存后可再次卖出 → 实际承诺超过可用库存（超卖）。
    // 正确做法是要求管理员先完成、取消或核对相关订单，再做模式切换。
    //
    // 判定依据必须是**未结束订单的下单快照**（orders.delivery_type），
    // 而不是商品当前的 delivery_type —— 商品类型可被反复修改，
    // 而旧订单始终按下单时的类型履约与释放库存。
    // 只看商品当前类型会被「manual → auto → manual」序列绕过：
    // 第二次编辑时 existing.deliveryType 已是 auto，守卫不触发，
    // 于是有限库存 1 件可被买家 B 买走，而 A 的人工订单仍然有效。
    if (modeChanged) {
      const activeOrder = tx
        .select({ orderNo: orders.orderNo, deliveryType: orders.deliveryType })
        .from(orders)
        .where(
          and(
            eq(orders.productId, id),
            inArray(orders.status, ["pending", "reconciling", "paid", "delivering"])
          )
        )
        .get();
      if (activeOrder) {
        return {
          ok: false,
          message: `该商品存在未结束订单（${activeOrder.orderNo}，下单时为${
            activeOrder.deliveryType === "auto" ? "自动发卡" : "人工发货"
          }），请先完成或取消后再切换库存模式`,
        };
      }
    }

    tx.update(products)
      .set({
        ...v.data,
        // 编辑留空币种 → 保持原值
        currency: input.currency?.trim() ? v.data.currency : existing.currency,
        updatedAt: new Date(),
      })
      .where(eq(products.id, id))
      .run();

    return { ok: true, message: "商品已更新" };
  }, { behavior: "immediate" });
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
  invalid: number;
  message: string;
}

/**
 * 批量导入卡密：一行一张；同一内容可导入多张（允许重复销售/测试场景）。
 * 并发与超卖安全由发货事务的条件 UPDATE（status='available'）保证。
 */
export function importCards(productId: number, raw: string): ImportCardsResult {
  const product = db.select().from(products).where(eq(products.id, productId)).get();
  if (!product) return { imported: 0, invalid: 0, message: "商品不存在" };
  if (product.deliveryType !== "auto") {
    return { imported: 0, invalid: 0, message: "仅自动发卡商品需要卡密" };
  }

  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l !== "");
  const valid = lines.filter((l) => l.length <= 500);
  const invalid = lines.length - valid.length;

  for (const content of valid) {
    db.insert(cards).values({ productId, content, status: "available" }).run();
  }
  return {
    imported: valid.length,
    invalid,
    message: `导入 ${valid.length} 张${invalid > 0 ? `，无效跳过 ${invalid} 行` : ""}`,
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
  /** 待对账订单：结果未知，需人工核对网关后再决定是否释放库存 */
  reconciling: number;
  /** 异常到账待处理：超时后收到成功回调，需人工补发或退款 */
  anomalies: number;
  /** 按币种分组的今日营收（禁止跨币种直接相加） */
  todayRevenue: CurrencyRevenue[];
  totalOrders: number;
  /** 按币种分组的累计营收 */
  totalRevenue: CurrencyRevenue[];
  pendingManual: number; // paid（待人工发货）
  delivering: number;
  lowStockProducts: { id: number; name: string; slug: string; availableCards: number }[];
}

export interface CurrencyRevenue {
  currency: string;
  orders: number;
  amount: number;
}

export function getDashboardStats(threshold: number): DashboardStats {
  const dayStart = startOfTodayBeijing();

  /**
   * 营收口径：以 paidAt 是否为 NULL 判定「是否真的收到过钱」。
   *
   * 不能用 status IN (paid,delivering,completed)——已付款订单被管理员关闭后
   * status 变为 closed，会从营收中凭空消失（少计已收款项）。
   * paidAt 只在 pending→paid 的真实入账时刻写入，是「收过钱」的可靠事实。
   *
   * 必须按 currency 分组：totalCents 是「最小单位」，随币种不同（JPY 无小数），
   * 直接把 USD 与 CNY 的金额相加会得出无意义的数字。
   */
  const revenueByCurrency = (from?: Date): CurrencyRevenue[] =>
    db
      .select({
        currency: orders.currency,
        orders: sql<number>`count(*)`,
        amount: sql<number>`coalesce(sum(${orders.totalCents}), 0)`,
      })
      .from(orders)
      .where(
        from ? and(isNotNull(orders.paidAt), gte(orders.paidAt, from)) : isNotNull(orders.paidAt)
      )
      .groupBy(orders.currency)
      .all();

  const today = revenueByCurrency(dayStart);
  const total = revenueByCurrency();
  const todayOrderCount = today.reduce((s, r) => s + r.orders, 0);
  const totalOrderCount = db.select({ n: sql<number>`count(*)` }).from(orders).get()?.n ?? 0;

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
    todayOrders: todayOrderCount,
    reconciling: countReconcilingOrders(),
    anomalies: countOpenAnomalies(),
    todayRevenue: today,
    totalOrders: totalOrderCount,
    totalRevenue: total,
    pendingManual: statusCount("paid"),
    delivering: statusCount("delivering"),
    lowStockProducts: lowStock,
  };
}

/**
 * 「今天」的起点（北京时间）。
 *
 * 站点所有面向用户的日期展示都用 Asia/Shanghai（见 lib/datetime），
 * 但 new Date().setHours(0,0,0,0) 按**服务器时区**切分——容器默认 UTC，
 * 会让「今日营收」与后台显示的北京时间错开 8 小时。
 */
export function startOfTodayBeijing(now: Date = new Date()): Date {
  const TZ_OFFSET_MS = 8 * 60 * 60 * 1000; // Asia/Shanghai 无夏令时，固定 UTC+8
  const shifted = new Date(now.getTime() + TZ_OFFSET_MS);
  shifted.setUTCHours(0, 0, 0, 0);
  return new Date(shifted.getTime() - TZ_OFFSET_MS);
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
  if (
    opts.status &&
    ["pending", "reconciling", "paid", "delivering", "completed", "expired", "closed"].includes(
      opts.status
    )
  ) {
    conds.push(eq(orders.status, opts.status));
  }
  const q = opts.q?.trim();
  if (q) {
    // 转义 LIKE 元字符：否则搜索 "%" 或 "_" 会被当成通配符（搜 % 返回全部订单）
    const escaped = escapeLike(q);
    conds.push(
      sql`(${orders.orderNo} LIKE ${"%" + escaped + "%"} ESCAPE '\\' OR lower(${orders.email}) LIKE ${"%" + escaped.toLowerCase() + "%"} ESCAPE '\\')`
    );
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
      // 展示**订单快照**（下单时的发货方式），而非商品当前配置：
      // 商品类型可被修改，用当前值会与订单的实际履约方式不符，
      // 也会误导后台操作（如错误地提供「重试自动发货」）。
      deliveryType: orders.deliveryType,
      /** 商品当前类型，仅用于在两者不一致时给出提示 */
      productDeliveryType: products.deliveryType,
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
  // 历史订单快照可能为空（迁移前的旧数据），回落商品当前值
  return rows.map((r) => ({
    ...r,
    deliveryType: r.deliveryType ?? r.productDeliveryType ?? "auto",
  }));
}

/** 异常到账待处理数（超时后到账，需人工补发或退款） */
export function countOpenAnomalies(): number {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(paymentAnomalies)
      .where(eq(paymentAnomalies.status, "open"))
      .get()?.c ?? 0
  );
}

/** 待对账订单数（结果未知，需人工核对网关） */
export function countReconcilingOrders(): number {
  return (
    db
      .select({ c: sql<number>`count(*)` })
      .from(orders)
      .where(eq(orders.status, "reconciling"))
      .get()?.c ?? 0
  );
}
