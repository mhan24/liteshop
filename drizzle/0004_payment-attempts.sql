-- 支付尝试模型：每个 trade_id 独立记录，解决「重新支付后被旧交易超时回调误关单」的竞态
--
-- 背景：原设计把 trade_id/paymentUrl 直接存在 orders 上并在重新发起时覆盖，
-- 且 orders.trade_id 带唯一索引。这带来两个问题：
--   1) 旧交易的延迟回调无法归属，status=3 会把已有新交易的订单直接置为 expired
--   2) 同一订单无法保留多次支付尝试的历史（对账依据丢失）
--
-- 因此：新建 payment_attempts 表；orders.trade_id 唯一索引改为普通索引
--（trade_id 的唯一性由 payment_attempts.trade_id 唯一索引保证）。

CREATE TABLE `payment_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`provider` text NOT NULL,
	`trade_id` text,
	`amount_cents` integer NOT NULL,
	`currency` text NOT NULL,
	`payment_url` text DEFAULT '' NOT NULL,
	`expected_actual_amount` text,
	`expiration_time` integer,
	`status` text DEFAULT 'pending' NOT NULL,
	`is_current` integer DEFAULT true NOT NULL,
	`raw` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_attempts_trade_id_uq` ON `payment_attempts` (`trade_id`);
--> statement-breakpoint
CREATE INDEX `payment_attempts_order_idx` ON `payment_attempts` (`order_no`);
--> statement-breakpoint
CREATE INDEX `payment_attempts_status_idx` ON `payment_attempts` (`status`);
--> statement-breakpoint
DROP INDEX IF EXISTS `orders_trade_id_uq`;
--> statement-breakpoint
CREATE INDEX `orders_trade_id_idx` ON `orders` (`trade_id`);
--> statement-breakpoint
-- 回填：把现有订单的当前交易迁移为一条 payment_attempt，保证历史订单可继续对账。
-- is_current 的语义是「该订单最新的一次支付尝试」，与订单是否已终态无关
-- （终态订单日后仍可能收到重复回调，需要能定位到具体尝试做幂等判断）。
INSERT INTO `payment_attempts`
  (`order_no`, `provider`, `trade_id`, `amount_cents`, `currency`, `payment_url`,
   `expected_actual_amount`, `expiration_time`, `status`, `is_current`, `paid_at`,
   `created_at`, `updated_at`)
SELECT
  `order_no`,
  'bepusdt',
  `trade_id`,
  `total_cents`,
  `currency`,
  COALESCE(`payment_url`, ''),
  `expected_actual_amount`,
  `expiration_time`,
  CASE
    WHEN `paid_at` IS NOT NULL THEN 'paid'
    WHEN `status` IN ('expired', 'closed') THEN 'expired'
    ELSE 'pending'
  END,
  true,
  `paid_at`,
  `created_at`,
  `updated_at`
FROM `orders`
WHERE `trade_id` IS NOT NULL;
