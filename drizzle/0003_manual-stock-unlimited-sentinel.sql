-- manual 库存哨兵从 0 改为 -1，消除「不限」与「售罄」的语义冲突
-- （0 曾兼表两者，导致库存扣到 0 后失去约束而超卖）
--
-- 历史数据判定：
--   1) auto 商品：stock_limit 不参与逻辑，统一置 -1（不限）
--   2) manual 商品且从未扣减过库存（无 stock_charged=1 的订单）：
--      原值 0 视为「不限」→ -1
--   3) manual 商品且扣减过库存（存在 stock_charged=1 的订单）：
--      说明它曾是有限库存，当前 0 更可能是「已售罄」→ 保留 0
UPDATE products
SET stock_limit = -1
WHERE stock_limit = 0
  AND (
    delivery_type <> 'manual'
    OR NOT EXISTS (
      SELECT 1 FROM orders
      WHERE orders.product_id = products.id
        AND orders.stock_charged = 1
    )
  );
