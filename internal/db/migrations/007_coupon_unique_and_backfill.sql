-- 007: 优惠券使用唯一约束 + 旧订单成本回填（估算）
-- 1) 清理历史脏数据：同一 order_no 可能有多条 coupon_usages（旧版无唯一约束）
--    按 order_no 保留一条，多余记录回退其对应券的 used_count。
DELETE FROM coupon_usages
WHERE id NOT IN (
    SELECT MIN(id) FROM coupon_usages GROUP BY order_no
) AND order_no != '';

-- coupon_usages.order_no 幂等约束，防止同一订单多次占用/回滚
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order ON coupon_usages(order_no);

-- 2) 旧订单成本回填：以当前商品成本估算历史订单成本（迁移估算，非真实历史快照）
--    使用外层 COALESCE：无对应商品时保持 0，避免违反 cost_cents NOT NULL。
--    已有 cost_cents>0 的订单不覆盖。
UPDATE orders
SET cost_cents = COALESCE(
    (SELECT p.cost_cents FROM products p WHERE p.id = orders.product_id),
    0
)
WHERE cost_cents = 0;
