-- 用**实际证据**校正订单的发货方式快照（0007 的回填只是近似）
--
-- 背景：0007 用商品当前的 delivery_type 回填历史订单。若某商品在迁移前
-- 被改过发货方式，回填值可能与订单实际的处理方式不符。
--
-- 更强的证据（与商品当前配置无关）：
--   1) cards.order_id = 订单号 → 该订单必然走过 auto 占卡流程
--      （auto 型下单即把卡密置为 reserved 并绑定 order_id；
--       sold 状态仍保留 order_id，只有 release 时才清空）
--   2) orders.stock_charged = 1 → 该订单必然走过 manual 扣库存流程
--      （auto 型该字段恒为 false）
--
-- 因此：有卡密绑定的订单校正为 auto；有库存扣减标记的校正为 manual。
-- 两者皆无的订单保持 0007 的回填值（这是当时唯一可用的信息），
-- 不做无根据的改动。
--
-- 注意：本迁移只**校正有明显证据的方向**，不猜测无证据的订单。

-- 证据 1：存在绑定到该订单的卡密 → auto
UPDATE `orders`
SET `delivery_type` = 'auto', `updated_at` = (unixepoch() * 1000)
WHERE `delivery_type` <> 'auto'
  AND EXISTS (
    SELECT 1 FROM `cards` WHERE `cards`.`order_id` = `orders`.`order_no`
  );
--> statement-breakpoint

-- 证据 2：下单时扣减过库存 → manual
-- （排除证据 1 已判定的 auto 订单，避免自相矛盾的数据被来回改写）
UPDATE `orders`
SET `delivery_type` = 'manual', `updated_at` = (unixepoch() * 1000)
WHERE `delivery_type` <> 'manual'
  AND `stock_charged` = 1
  AND NOT EXISTS (
    SELECT 1 FROM `cards` WHERE `cards`.`order_id` = `orders`.`order_no`
  );
