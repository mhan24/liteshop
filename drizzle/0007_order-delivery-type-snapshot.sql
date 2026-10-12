-- 订单发货方式快照：履约与库存释放以订单为准，不再依赖可变的商品配置
--
-- 问题：后台允许修改商品的 delivery_type，而订单关闭/超时/履约时读取的是
-- 商品**当前**类型。若商品从 manual 改为 auto，已有待支付订单在超时时
-- 会走 auto 的释放逻辑，导致原先扣减的人工库存无法回补；反之亦然。

ALTER TABLE `orders` ADD COLUMN `delivery_type` text;
--> statement-breakpoint
-- 回填历史订单：以当前商品类型为准（这是当时唯一可用的信息）
UPDATE `orders`
SET `delivery_type` = (
  SELECT `products`.`delivery_type` FROM `products` WHERE `products`.`id` = `orders`.`product_id`
)
WHERE `orders`.`delivery_type` IS NULL AND `orders`.`product_id` IS NOT NULL;
--> statement-breakpoint
-- 商品已删除的订单：无法回溯，按 manual 处理（保守：不会误释放卡池）
UPDATE `orders` SET `delivery_type` = 'manual' WHERE `delivery_type` IS NULL;
