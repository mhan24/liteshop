-- LiteShop 数据库迁移
-- 001_init.sql - 初始 schema（幂等，IF NOT EXISTS）
-- 对已存在的旧库，本文件只会补齐缺失的表，不会改动已有表结构。
-- 存量库的列级升级见 002_legacy_upgrade (Go 迁移)。

-- 管理员
CREATE TABLE IF NOT EXISTS admins (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'operator',
    created_at INTEGER NOT NULL
);

-- 商品
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    image_url TEXT NOT NULL DEFAULT '',
    price_cents INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    category TEXT NOT NULL DEFAULT '',
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_pinned INTEGER NOT NULL DEFAULT 0,
    faq TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);

-- 卡密
CREATE TABLE IF NOT EXISTS cards (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_id INTEGER NOT NULL REFERENCES products(id),
    reserved_order INTEGER NOT NULL DEFAULT 0,
    sold_order INTEGER NOT NULL DEFAULT 0,
    content TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'available',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    sold_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id, status);

-- 订单
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_no TEXT NOT NULL UNIQUE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    qty INTEGER NOT NULL,
    amount_cents INTEGER NOT NULL,
    fiat TEXT NOT NULL,
    trade_type TEXT NOT NULL,
    buyer_contact TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    trade_id TEXT NOT NULL DEFAULT '',
    payment_url TEXT NOT NULL DEFAULT '',
    block_transaction_id TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    paid_at INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);

-- 订单事件日志
CREATE TABLE IF NOT EXISTS order_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    order_id INTEGER NOT NULL REFERENCES orders(id),
    event TEXT NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    from_status TEXT NOT NULL DEFAULT '',
    to_status TEXT NOT NULL DEFAULT '',
    admin_id INTEGER NOT NULL DEFAULT 0,
    metadata TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_order_logs_order ON order_logs(order_id, id);

-- 管理员审计日志
CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    admin_id INTEGER NOT NULL DEFAULT 0,
    username TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    target_type TEXT NOT NULL DEFAULT '',
    target_id TEXT NOT NULL DEFAULT '',
    before_value TEXT NOT NULL DEFAULT '',
    after_value TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(id);

-- 站点配置
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
);
