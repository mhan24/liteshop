-- 限流计数器持久化：使限流在进程重启与多实例部署下保持一致
--
-- 原实现把计数放在进程内存（Map）中，重启即清零，多副本时各算各的，
-- 攻击者可通过重启或把请求分散到多个副本来绕过限流（含管理员登录锁定）。

CREATE TABLE `rate_limit_counters` (
	`bucket_key` text PRIMARY KEY NOT NULL,
	`count` integer DEFAULT 0 NOT NULL,
	`reset_at` integer NOT NULL,
	`updated_at` integer
);
--> statement-breakpoint
CREATE INDEX `rate_limit_reset_idx` ON `rate_limit_counters` (`reset_at`);
