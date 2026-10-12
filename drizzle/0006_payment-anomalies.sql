-- 异常到账（超时后到账）待人工处置
--
-- 场景：买家在支付有效期内完成链上付款，成功回调却在本地清扫把订单置为
-- expired 之后才到达。此时已释放的卡密可能被他人买走，直接恢复原订单
-- 会造成一卡多卖。因此登记为独立事项，由管理员核对到账后补发或退款。

CREATE TABLE `payment_anomalies` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`provider` text NOT NULL,
	`trade_id` text,
	`amount` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT '' NOT NULL,
	`order_status_at_arrival` text NOT NULL,
	`kind` text DEFAULT 'late_payment' NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	`payload` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `payment_anomalies_order_idx` ON `payment_anomalies` (`order_no`);
--> statement-breakpoint
CREATE INDEX `payment_anomalies_status_idx` ON `payment_anomalies` (`status`);
