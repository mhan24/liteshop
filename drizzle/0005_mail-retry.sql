-- 邮件重试模型：failed 可重试、sending 租约防并发、记录尝试次数与下次重试时间
--
-- 历史缺陷：mail_logs 只区分 sent/failed，发送前「存在记录就跳过」，
-- 导致首次失败后（除非管理员手动 force）永远不会再尝试投递。
--
-- 注意：SQLite 的 ALTER TABLE ADD COLUMN 只接受**常量**默认值，
-- 因此这里不能用 (unixepoch() * 1000)，改为 DEFAULT 0 并在回填语句里赋值。
-- （CREATE TABLE 允许非常量默认值，所以 0000/0004 里可以那样写。）

ALTER TABLE `mail_logs` ADD COLUMN `attempts` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
ALTER TABLE `mail_logs` ADD COLUMN `next_retry_at` integer;
--> statement-breakpoint
ALTER TABLE `mail_logs` ADD COLUMN `updated_at` integer DEFAULT 0 NOT NULL;
--> statement-breakpoint
CREATE INDEX `mail_logs_retry_idx` ON `mail_logs` (`status`, `next_retry_at`);
--> statement-breakpoint
-- 历史 failed 记录：允许立即重试（尝试次数未知，按 1 计）
UPDATE `mail_logs` SET `attempts` = 1, `next_retry_at` = (unixepoch() * 1000), `updated_at` = (unixepoch() * 1000) WHERE `status` = 'failed';
--> statement-breakpoint
-- 历史 sent 记录：标记 attempts=1 且不再重试
UPDATE `mail_logs` SET `attempts` = 1, `next_retry_at` = NULL, `updated_at` = (unixepoch() * 1000) WHERE `status` = 'sent';
