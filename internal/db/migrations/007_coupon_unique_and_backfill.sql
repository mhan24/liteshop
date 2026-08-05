-- 007: 优惠券使用唯一约束 + 旧订单成本回填（估算）
-- 1) 清理历史脏数据：同一 order_no 可能有多条 coupon_usages（旧版无唯一约束）。
--    先聚合各券各订单重复使用量，回退 used_count（下限 0），再删除多余记录。
--    空 order_no 的历史记录属于无效脏数据，予以保留不阻断索引（部分唯一索引）。

-- 1a) 聚合重复量：每券每订单超出 1 条的部分
DROP TABLE IF EXISTS coupon_usage_dupes;
CREATE TEMP TABLE coupon_usage_dupes AS
SELECT coupon_id, order_no, COUNT(*) - 1 AS dupe_count
FROM coupon_usages
WHERE order_no <> ''
GROUP BY coupon_id, order_no
HAVING COUNT(*) > 1;

-- 1b) 按券汇总回退总量（正确处理同一券多个重复订单组）
UPDATE coupons
SET used_count = MAX(0, used_count - COALESCE((
    SELECT SUM(dupe_count) FROM coupon_usage_dupes d WHERE d.coupon_id = coupons.id
), 0));

DROP TABLE coupon_usage_dupes;

-- 1c) 删除重复记录（保留每组 order_no 的最小 id 一条），仅限非空订单号
DELETE FROM coupon_usages
WHERE order_no <> ''
  AND id NOT IN (
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
