import {
  bigint,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

/**
 * 卡密商城数据模型（PostgreSQL，从零设计）。
 *
 * 金额一律 bigint「最小货币单位」（分），禁止浮点参与金额运算。
 * 订单状态机：pending → paid → completed；pending → closed | reconciling；
 *            reconciling → paid | closed。终态：completed / closed。
 * 支付状态机：pending → confirmed | expired | failed；confirmed 之后若发现
 *            归属异常（订单已关闭收到到账）记为 late（对账特例，不推进订单）。
 * 卡密状态机：available → reserved（下单锁卡）→ sold（支付确认交付）；
 *            reserved → available（关单/过期释放）。
 */

/* ================= 站点配置（KV） ================= */

export const settings = pgTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ================= 管理员 ================= */


export const admins = pgTable("admins", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  // scrypt（node:crypto）哈希：scrypt:N:r:p:salt:hash
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ================= 商品目录 ================= */


export const categories = pgTable("categories", {
  id: serial("id").primaryKey(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});


export const products = pgTable(
  "products",
  {
    id: serial("id").primaryKey(),
    categoryId: integer("category_id").references(() => categories.id, { onDelete: "set null" }),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    /** 最小货币单位（分）；站点统一币种（settings.currency） */
    priceCents: bigint("price_cents", { mode: "number" }).notNull(),
    /** auto = 卡密自动发货；manual = 人工发货（email 通知 + 后台录入） */
    deliveryType: text("delivery_type", { enum: ["auto", "manual"] }).notNull(),
    /** manual 型库存上限；null = 不限库存 */
    stockLimit: integer("stock_limit"),
    /** 上架状态 */
    status: text("status", { enum: ["on", "off"] }).notNull().default("on"),
    imageUrl: text("image_url"),
    /** SEO 描述（留空时由 description 截断） */
    seoDescription: text("seo_description"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("products_category_idx").on(t.categoryId), index("products_status_idx").on(t.status)]
);

/* ================= 卡密库存 ================= */


export const orders = pgTable(
  "orders",
  {
    id: uuid("id").primaryKey().default(sql`gen_random_uuid()`),
    orderNo: text("order_no").notNull().unique(),
    email: text("email").notNull(),
    /** 每笔订单独立查单密码（Argon2id 哈希；明文只在下单响应出现一次） */
    queryPasswordHash: text("query_password_hash").notNull(),
    status: text("status", {
      enum: ["pending", "paid", "completed", "closed", "reconciling"],
    }).notNull()
      .default("pending"),
    currency: text("currency").notNull(),
    subtotalCents: bigint("subtotal_cents", { mode: "number" }).notNull(),
    totalCents: bigint("total_cents", { mode: "number" }).notNull(),
    note: text("note"),
    /** 支付窗口截止；过期由惰性清扫 + cron 关单并释放卡密 */
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    paidAt: timestamp("paid_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("orders_email_idx").on(t.email),
    index("orders_status_expires_idx").on(t.status, t.expiresAt),
    index("orders_created_idx").on(t.createdAt),
  ]
);


export const orderItems = pgTable(
  "order_items",
  {
    id: serial("id").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    /** 快照：商品此后改名/改价不影响订单 */
    productId: integer("product_id").references(() => products.id, { onDelete: "set null" }),
    productName: text("product_name").notNull(),
    unitPriceCents: bigint("unit_price_cents", { mode: "number" }).notNull(),
    quantity: integer("quantity").notNull(),
    lineTotalCents: bigint("line_total_cents", { mode: "number" }).notNull(),
  },
  (t) => [index("order_items_order_idx").on(t.orderId)]
);

/* ================= 支付渠道与支付记录 ================= */


export const cards = pgTable(
  "cards",
  {
    id: serial("id").primaryKey(),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    /** available → reserved（下单锁卡）→ sold（支付确认）；reserved 可释放回 available */
    status: text("status", { enum: ["available", "reserved", "sold"] }).notNull().default("available"),
    reservedOrderId: uuid("reserved_order_id").references(() => orders.id, { onDelete: "set null" }),
    soldAt: timestamp("sold_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cards_product_status_idx").on(t.productId, t.status),
    index("cards_reserved_order_idx").on(t.reservedOrderId),
    // 同一商品下卡密内容唯一，防止重复导入
    uniqueIndex("cards_product_content_uq").on(t.productId, t.content),
  ]
);

/* ================= 订单 ================= */


export const paymentChannels = pgTable("payment_channels", {
  id: serial("id").primaryKey(),
  /** 回调路由标识（/api/webhooks/pay/[key]），创建后不变 */
  key: text("key").notNull().unique(),
  /** epusdt = BEpusdt 兼容收银台（覆盖 LitePay / 自建 BEpusdt）；mock = 本地模拟 */
  type: text("type", { enum: ["epusdt", "mock"] }).notNull(),
  displayName: text("display_name").notNull(),
  apiBase: text("api_base"),
  /** AES-256-GCM 加密存储（密钥派生自 AUTH_SECRET），前端永不回显 */
  tokenEnc: text("token_enc"),
  currencies: text("currencies"),
  timeoutSeconds: integer("timeout_seconds").notNull().default(600),
  reselect: boolean("reselect").notNull().default(true),
  /** 前台展示排序：小在前；同序按 id */
  sortOrder: integer("sort_order").notNull().default(0),
  enabled: boolean("enabled").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});


export const payments = pgTable(
  "payments",
  {
    id: serial("id").primaryKey(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    channelId: integer("channel_id")
      .notNull()
      .references(() => paymentChannels.id),
    /** 网关交易号（trade_id）；创建响应丢失时为 null */
    providerRef: text("provider_ref"),
    status: text("status", {
      enum: ["pending", "confirmed", "expired", "failed", "late"],
    }).notNull()
      .default("pending"),
    /** 每单只有一条「当前支付尝试」；重新发起支付会作废旧尝试 */
    isCurrent: boolean("is_current").notNull().default(true),
    amountCents: bigint("amount_cents", { mode: "number" }).notNull(),
    currency: text("currency").notNull(),
    /** 网关返回的应付加密货币数量快照（字符串原样保存，用于到账核对） */
    expectedAmount: text("expected_amount"),
    paymentUrl: text("payment_url"),
    /** 延迟到账/重复到账标记（对账特例，不推进订单） */
    anomaly: text("anomaly", { enum: ["late", "duplicate"] }),
    raw: jsonb("raw"),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    // 幂等锚点：同一渠道的同一笔网关交易只能确认一次
    uniqueIndex("payments_channel_ref_uq")
      .on(t.channelId, t.providerRef)
      .where(sql`provider_ref is not null`),
    index("payments_order_idx").on(t.orderId),
    index("payments_current_idx").on(t.orderId, t.isCurrent),
  ]
);

/* ================= 卡密交付（幂等） ================= */


export const deliveries = pgTable(
  "deliveries",
  {
    id: serial("id").primaryKey(),
    /** 每单最多一条交付记录：数据库级幂等锚点 */
    orderId: uuid("order_id")
      .notNull()
      .unique()
      .references(() => orders.id, { onDelete: "cascade" }),
    content: text("content").notNull(),
    cardIds: jsonb("card_ids").notNull().$type<number[]>(),
    /** 交付邮件重试 */
    emailAttempts: integer("email_attempts").notNull().default(0),
    emailSentAt: timestamp("email_sent_at", { withTimezone: true }),
    emailError: text("email_error"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("deliveries_email_pending_idx").on(t.emailSentAt, t.emailAttempts)]
);

/* ================= 回调审计 ================= */


export const notifyLogs = pgTable(
  "notify_logs",
  {
    id: serial("id").primaryKey(),
    channelKey: text("channel_key").notNull(),
    orderNo: text("order_no"),
    providerRef: text("provider_ref"),
    payloadHash: text("payload_hash").notNull(),
    payload: text("payload").notNull(),
    handled: boolean("handled").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("notify_logs_hash_idx").on(t.payloadHash), index("notify_logs_created_idx").on(t.createdAt)]
);

/* ================= 管理审计 ================= */


export const auditLogs = pgTable(
  "audit_logs",
  {
    id: serial("id").primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    detail: text("detail"),
    ip: text("ip"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_logs_created_idx").on(t.createdAt)]
);

