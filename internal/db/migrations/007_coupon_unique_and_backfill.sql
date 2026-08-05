-- 007: 优惠券使用唯一约束 + 旧订单成本回填（估算）
-- 1) 清理历史脏数据：同一 order_no 可能有多条 coupon_usages（旧版无唯一约束）。
--    先为每个 coupon 每笔重复 order_no 回退 used_count（下限 0），再删除多余记录。

-- 1a) 回退 used_count：同一订单重复使用某券 N 次，只保留 1 次，多出的 N-1 次回退
UPDATE coupons
SET used_count = MAX(0, used_count - (
    SELECT COUNT(*) - 1
    FROM coupon_usages u
    WHERE u.coupon_id = coupons.id
      AND u.order_no <> ''
    GROUP BY u.coupon_id, u.order_no
));

-- 1b) 删除重复使用记录（保留每组 order_no 的最小 id 一条）
DELETE FROM coupon_usages
WHERE id NOT IN (
    SELECT MIN(id) FROM coupon_usages WHERE order_no <> '' GROUP BY order_no
);

-- 2) 部分唯一索引：仅约束非空订单号（历史空 order_no 记录不阻断迁移）
--    先删除旧版全列唯一索引（若存在），避免 IF NOT EXISTS 跳过导致部分索引不生效
DROP INDEX IF EXISTS idx_coupon_usage_order;
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order
ON coupon_usages(order_no) WHERE order_no <> '';

-- 3) 旧订单成本回填：以当前商品成本估算历史订单成本（迁移估算，非真实历史快照）
--    使用外层 COALESCE：无对应商品时保持 0，避免违反 cost_cents NOT NULL。
--    已有 cost_cents>0 的订单不覆盖。
UPDATE orders
SET cost_cents = COALESCE(
    (SELECT p.cost_cents FROM products p WHERE p.id = orders.product_id),
    0
)
WHERE cost_cents = 0;
