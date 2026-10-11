CREATE TABLE `mail_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`kind` text NOT NULL,
	`email` text NOT NULL,
	`status` text DEFAULT 'sent' NOT NULL,
	`error` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `mail_logs_order_kind_uq` ON `mail_logs` (`order_no`,`kind`);