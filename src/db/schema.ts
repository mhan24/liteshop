import { sql } from "drizzle-orm";
import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/** 状态统一使用 string union（PLAN §8 Implementation Notes） */
export const DeliveryType = {
  auto: "auto",
  manual: "manual",
} as const;
export type DeliveryType = (typeof DeliveryType)[keyof typeof DeliveryType];

export const OrderStatus = {
  pending: "pending",
  paid: "paid",
  delivering: "delivering",
  completed: "completed",
  expired: "expired",
  closed: "closed",
} as const;
export type OrderStatus = (typeof OrderStatus)[keyof typeof OrderStatus];

export const CardStatus = {
  available: "available",
  reserved: "reserved",
  sold: "sold",
} as const;
export type CardStatus = (typeof CardStatus)[keyof typeof CardStatus];

export const OrderStatusList: readonly OrderStatus[] = Object.values(OrderStatus);

/** settings 便捷类型：各表行结构（$inferSelect） */
export type Product = typeof products.$inferSelect;
export type NewProduct = typeof products.$inferInsert;
export type Card = typeof cards.$inferSelect;
export type Order = typeof orders.$inferSelect;
export type NewOrder = typeof orders.$inferInsert;
export type Setting = typeof settings.$inferSelect;
export type PaymentConfig = typeof paymentConfigs.$inferSelect;
export type AdminLog = typeof adminLogs.$inferSelect;
export type NotifyLog = typeof notifyLogs.$inferSelect;

const ts = () => integer("created_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);
const tsUpdated = () => integer("updated_at", { mode: "timestamp_ms" }).notNull().default(sql`(unixepoch() * 1000)`);

export const products = sqliteTable(
  "products",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    description: text("description").notNull().default(""),
    imageUrl: text("image_url"),
    /** 售价，整数分（禁止浮点运算，边界经 lib/money.toCents 转换） */
    priceCents: integer("price_cents").notNull(),
    currency: text("currency").notNull().default("CNY"),
    /** JSON 自由扩展位（多档价格、SEO 位等） */
    extra: text("extra", { mode: "json" }),
    deliveryType: text("delivery_type").notNull().default(DeliveryType.auto),
    /** manual 型库存上限，0 = 不限 */
    stockLimit: integer("stock_limit").notNull().default(0),
    /** "on" | "off" */
    status: text("status").notNull().default("on"),
    sort: integer("sort").notNull().default(0),
    createdAt: ts(),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("products_slug_uq").on(t.slug)]
);

export const cards = sqliteTable(
  "cards",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    productId: integer("product_id")
      .notNull()
      .references(() => products.id),
    content: text("content").notNull(),
    status: text("status").notNull().default(CardStatus.available),
    orderId: text("order_id"),
    soldAt: integer("sold_at", { mode: "timestamp_ms" }),
    createdAt: ts(),
  },
  (t) => [
    // 数据库层拒绝重复导入（PLAN §3）：同一商品下内容唯一
    uniqueIndex("cards_product_content_uq").on(t.productId, t.content),
    index("cards_product_status_idx").on(t.productId, t.status),
    index("cards_order_idx").on(t.orderId),
  ]
);

export const orders = sqliteTable(
  "orders",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** LS + YYYYMMDD + 8 位随机 + 2 位校验和，非自增、不暴露销量 */
    orderNo: text("order_no").notNull(),
    productId: integer("product_id").references(() => products.id),
    /** 下单时刻商品快照 */
    productName: text("product_name").notNull(),
    unitPriceCents: integer("unit_price_cents").notNull(),
    currency: text("currency").notNull().default("CNY"),
    quantity: integer("quantity").notNull().default(1),
    totalCents: integer("total_cents").notNull(),
    email: text("email").notNull(),
    note: text("note"),
    status: text("status").notNull().default(OrderStatus.pending),
    /** manual 型下单时是否执行过库存扣减（关闭/过期时回补的依据） */
    stockCharged: integer("stock_charged", { mode: "boolean" }).notNull().default(false),
    /** 交付内容：自动发卡的卡密或人工录入内容，仅在支付后对买家可见 */
    deliveryContent: text("delivery_content"),
    /** bepusdt 创建交易响应快照（对账依据） */
    tradeId: text("trade_id"),
    expectedActualAmount: text("expected_actual_amount"),
    expirationTime: integer("expiration_time", { mode: "timestamp_ms" }),
    blockTxnId: text("block_txn_id"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdAt: ts(),
    updatedAt: tsUpdated(),
  },
  (t) => [
    uniqueIndex("orders_order_no_uq").on(t.orderNo),
    uniqueIndex("orders_trade_id_uq").on(t.tradeId),
    index("orders_status_idx").on(t.status),
    index("orders_email_idx").on(t.email),
  ]
);

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull().default(""),
  updatedAt: tsUpdated(),
});

/** 支付渠道配置：新增渠道加行不改表（PLAN §3） */
export const paymentConfigs = sqliteTable(
  "payment_configs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    enabled: integer("enabled", { mode: "boolean" }).notNull().default(false),
    configJson: text("config_json", { mode: "json" }).notNull().default("{}"),
    createdAt: ts(),
    updatedAt: tsUpdated(),
  },
  (t) => [uniqueIndex("payment_configs_provider_uq").on(t.provider)]
);

export const adminLogs = sqliteTable(
  "admin_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    action: text("action").notNull(),
    target: text("target").notNull().default(""),
    detail: text("detail").notNull().default(""),
    ip: text("ip").notNull().default(""),
    createdAt: ts(),
  },
  (t) => [index("admin_logs_created_idx").on(t.createdAt)]
);

export const notifyLogs = sqliteTable(
  "notify_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    provider: text("provider").notNull(),
    orderNo: text("order_no").notNull().default(""),
    /** sha256(raw_body)，用于重复通知识别 / 重放排查 */
    payloadHash: text("payload_hash").notNull(),
    payload: text("payload").notNull(),
    status: integer("status"),
    handled: integer("handled", { mode: "boolean" }).notNull().default(false),
    createdAt: ts(),
  },
  (t) => [
    index("notify_logs_hash_idx").on(t.payloadHash),
    index("notify_logs_order_idx").on(t.orderNo),
  ]
);

/** 邮件发送记录：unique(order_no, kind) 保证同类邮件只发一次（kind: delivered | processing） */
export const mailLogs = sqliteTable(
  "mail_logs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderNo: text("order_no").notNull(),
    kind: text("kind").notNull(),
    email: text("email").notNull(),
    status: text("status").notNull().default("sent"),
    error: text("error").notNull().default(""),
    createdAt: ts(),
  },
  (t) => [uniqueIndex("mail_logs_order_kind_uq").on(t.orderNo, t.kind)]
);
