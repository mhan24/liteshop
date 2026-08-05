-- 007: 优惠券使用唯一约束 + 旧订单成本回填（估算）
-- coupon_usages.order_no 幂等约束，防止同一订单多次占用/回滚
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order ON coupon_usages(order_no);

-- 旧订单成本回填：以当前商品成本估算历史订单成本（迁移估算，非真实历史快照）
-- 已有 cost_cents>0 的订单不覆盖；无对应商品的订单保持 0
UPDATE orders SET cost_cents = (
    SELECT COALESCE(p.cost_cents, 0) FROM products p WHERE p.id = orders.product_id
) WHERE cost_cents = 0;
