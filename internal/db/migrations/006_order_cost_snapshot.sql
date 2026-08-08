-- 006: 订单成本快照（历史毛利不随商品成本变动漂移）
ALTER TABLE orders ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0;
