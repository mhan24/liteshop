-- 003_promotion.sql - 营销功能（优惠券 + 批发价 + 限购 + 成本价）
-- 由 Go 迁移器执行（migrations/003_promotion.sql + legacyUpgrade 的 promoteUpgrade 步骤）

-- 优惠券表
CREATE TABLE IF NOT EXISTS coupons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'fixed',       -- fixed | percent
    value_cents INTEGER NOT NULL DEFAULT 0,    -- 固定抵扣（分）
    percent INTEGER NOT NULL DEFAULT 0,        -- 百分比抵扣 (1-100)
    min_amount_cents INTEGER NOT NULL DEFAULT 0, -- 最低订单金额（分）
    max_uses INTEGER NOT NULL DEFAULT 0,        -- 使用次数上限（0=不限）
    used_count INTEGER NOT NULL DEFAULT 0,
    product_id INTEGER NOT NULL DEFAULT 0,      -- 适用商品（0=全部）
    active INTEGER NOT NULL DEFAULT 1,
    expires_at INTEGER NOT NULL DEFAULT 0,      -- 过期时间（0=永不过期）
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coupons_code ON coupons(code);

-- 优惠券使用记录
CREATE TABLE IF NOT EXISTS coupon_usages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    coupon_id INTEGER NOT NULL,
    order_no TEXT NOT NULL DEFAULT '',
    discount_cents INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_coupon_usages_coupon ON coupon_usages(coupon_id);
