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
  /**
   * 支付创建结果未知（超时/5xx）：网关可能已建单，也可能没有。
   * 此状态**不会**被超时清扫自动释放库存——必须经人工或查询网关确认
   * 交易确实不存在后才能关单，否则会出现「网关有支付地址、商店已释放卡密」。
   */
  reconciling: "reconciling",
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
    /**
     * manual 型库存上限。
     * -1 = 不限库存（哨兵值）；>= 0 = 剩余可售数量（0 表示已售罄）。
     * 注意：历史数据用 0 兼表「不限」，语义与「售罄」冲突，
     * 会导致扣减到 0 后失去库存约束而超卖，故改用 -1（见 lib/stock.ts）。
     */
    stockLimit: integer("stock_limit").notNull().default(-1),
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
    // 允许同一内容导入多张（重复销售/测试场景）；并发安全由发货事务的条件 UPDATE 保证
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
    /** 收银台地址：待支付期间复用（继续支付），过期后由 resume 重新创建 */
    paymentUrl: text("payment_url"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdAt: ts(),
    updatedAt: tsUpdated(),
  },
  (t) => [
    uniqueIndex("orders_order_no_uq").on(t.orderNo),
    // 注意：不再对 trade_id 建唯一索引——同一订单可多次发起支付（每次一个新 trade_id），
    // 唯一性改由 payment_attempts.trade_id 保证。
    index("orders_trade_id_idx").on(t.tradeId),
    index("orders_status_idx").on(t.status),
    index("orders_email_idx").on(t.email),
  ]
);

/** 支付尝试状态机 */
export const PaymentAttemptStatus = {
  /** 已创建，等待买家支付 */
  pending: "pending",
  /** 已确认到账（该尝试成功） */
  paid: "paid",
  /** 超时/被替换，不再有效 */
  expired: "expired",
  /** 结果未知（创建超时等），需对账确认 */
  unknown: "unknown",
} as const;
export type PaymentAttemptStatusType =
  (typeof PaymentAttemptStatus)[keyof typeof PaymentAttemptStatus];

/**
 * 支付尝试（每次「发起支付」一行）。
 *
 * 解决的问题：订单原先把 trade_id/paymentUrl 直接存在 orders 上并被覆盖，
 * 导致旧交易的延迟回调无法识别、可能误关一张已有新交易的订单。
 * 现在每个 trade_id 独立成行，回调先按 trade_id 定位到具体尝试再决定影响。
 */
export const paymentAttempts = sqliteTable(
  "payment_attempts",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderNo: text("order_no").notNull(),
    provider: text("provider").notNull(),
    /** 渠道交易号；唯一，是回调归属的判据 */
    tradeId: text("trade_id"),
    amountCents: integer("amount_cents").notNull(),
    currency: text("currency").notNull(),
    paymentUrl: text("payment_url").notNull().default(""),
    expectedActualAmount: text("expected_actual_amount"),
    expirationTime: integer("expiration_time", { mode: "timestamp_ms" }),
    status: text("status").notNull().default(PaymentAttemptStatus.pending),
    /** 是否仍是订单的当前有效尝试（只有它能把订单推向 paid/completed） */
    isCurrent: integer("is_current", { mode: "boolean" }).notNull().default(true),
    /** 渠道原始响应快照（对账） */
    raw: text("raw"),
    paidAt: integer("paid_at", { mode: "timestamp_ms" }),
    createdAt: ts(),
    updatedAt: tsUpdated(),
  },
  (t) => [
    uniqueIndex("payment_attempts_trade_id_uq").on(t.tradeId),
    index("payment_attempts_order_idx").on(t.orderNo),
    index("payment_attempts_status_idx").on(t.status),
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

/**
 * 异常到账（超时订单收到成功支付）。
 *
 * 场景：买家在支付有效期内完成链上付款，但成功回调在本地清扫把订单置为
 * expired 之后才到达。此时卡密已释放，**不能直接恢复原订单**（可能已被
 * 他人买走，直接发卡会造成一卡多卖/超卖）。
 * 因此记录为独立的「异常到账」待人工处置：核对链上到账后补发或退款。
 *
 * 不复用 notify_logs 的原因：那是原始报文流水，本表是**需要跟进的业务事项**，
 * 有独立的处理状态与操作人。
 */
export const AnomalyStatus = {
  /** 待人工处置 */
  open: "open",
  /** 已补发商品 */
  reissued: "reissued",
  /** 已退款 */
  refunded: "refunded",
  /** 已核实为误报（如重复回调、金额不符） */
  dismissed: "dismissed",
} as const;
export type AnomalyStatusType = (typeof AnomalyStatus)[keyof typeof AnomalyStatus];

export const paymentAnomalies = sqliteTable(
  "payment_anomalies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    orderNo: text("order_no").notNull(),
    provider: text("provider").notNull(),
    /** 网关交易号：核对链上到账的依据 */
    tradeId: text("trade_id"),
    /** 回调声明的法币金额（原样） */
    amount: text("amount").notNull().default(""),
    currency: text("currency").notNull().default(""),
    /** 订单在异常发生时的状态（一般为 expired / closed） */
    orderStatusAtArrival: text("order_status_at_arrival").notNull(),
    /** 异常类型：late_payment=超时后到账 */
    kind: text("kind").notNull().default("late_payment"),
    status: text("status").notNull().default(AnomalyStatus.open),
    /** 处理备注（管理员填写） */
    resolution: text("resolution").notNull().default(""),
    /** 原始回调报文（截断） */
    payload: text("payload").notNull().default(""),
    createdAt: ts(),
    updatedAt: tsUpdated(),
  },
  (t) => [
    index("payment_anomalies_order_idx").on(t.orderNo),
    index("payment_anomalies_status_idx").on(t.status),
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
    /**
     * sent   = 已成功送达
     * failed = 尝试过但失败（可被定时重试）
     * sending = 发送中（租约状态，防止并发重复发送）
     */
    status: text("status").notNull().default("sent"),
    error: text("error").notNull().default(""),
    /** 已尝试次数（含成功那次） */
    attempts: integer("attempts").notNull().default(0),
    /** 下次可重试时间；NULL = 无需重试 */
    nextRetryAt: integer("next_retry_at", { mode: "timestamp_ms" }),
    createdAt: ts(),
    updatedAt: tsUpdated(),
  },
  (t) => [
    uniqueIndex("mail_logs_order_kind_uq").on(t.orderNo, t.kind),
    index("mail_logs_retry_idx").on(t.status, t.nextRetryAt),
  ]
);
