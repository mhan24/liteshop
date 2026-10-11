CREATE TABLE `admin_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`action` text NOT NULL,
	`target` text DEFAULT '' NOT NULL,
	`detail` text DEFAULT '' NOT NULL,
	`ip` text DEFAULT '' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `admin_logs_created_idx` ON `admin_logs` (`created_at`);--> statement-breakpoint
CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`product_id` integer NOT NULL,
	`content` text NOT NULL,
	`status` text DEFAULT 'available' NOT NULL,
	`order_id` text,
	`sold_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_product_content_uq` ON `cards` (`product_id`,`content`);--> statement-breakpoint
CREATE INDEX `cards_product_status_idx` ON `cards` (`product_id`,`status`);--> statement-breakpoint
CREATE INDEX `cards_order_idx` ON `cards` (`order_id`);--> statement-breakpoint
CREATE TABLE `notify_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`order_no` text DEFAULT '' NOT NULL,
	`payload_hash` text NOT NULL,
	`payload` text NOT NULL,
	`status` integer,
	`handled` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `notify_logs_hash_idx` ON `notify_logs` (`payload_hash`);--> statement-breakpoint
CREATE INDEX `notify_logs_order_idx` ON `notify_logs` (`order_no`);--> statement-breakpoint
CREATE TABLE `orders` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`order_no` text NOT NULL,
	`product_id` integer,
	`product_name` text NOT NULL,
	`unit_price_cents` integer NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`quantity` integer DEFAULT 1 NOT NULL,
	`total_cents` integer NOT NULL,
	`email` text NOT NULL,
	`note` text,
	`status` text DEFAULT 'pending' NOT NULL,
	`stock_charged` integer DEFAULT false NOT NULL,
	`delivery_content` text,
	`trade_id` text,
	`expected_actual_amount` text,
	`expiration_time` integer,
	`block_txn_id` text,
	`paid_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `orders_order_no_uq` ON `orders` (`order_no`);--> statement-breakpoint
CREATE UNIQUE INDEX `orders_trade_id_uq` ON `orders` (`trade_id`);--> statement-breakpoint
CREATE INDEX `orders_status_idx` ON `orders` (`status`);--> statement-breakpoint
CREATE INDEX `orders_email_idx` ON `orders` (`email`);--> statement-breakpoint
CREATE TABLE `payment_configs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`provider` text NOT NULL,
	`enabled` integer DEFAULT false NOT NULL,
	`config_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `payment_configs_provider_uq` ON `payment_configs` (`provider`);--> statement-breakpoint
CREATE TABLE `products` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`slug` text NOT NULL,
	`description` text DEFAULT '' NOT NULL,
	`image_url` text,
	`price_cents` integer NOT NULL,
	`currency` text DEFAULT 'CNY' NOT NULL,
	`extra` text,
	`delivery_type` text DEFAULT 'auto' NOT NULL,
	`stock_limit` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'on' NOT NULL,
	`sort` integer DEFAULT 0 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `products_slug_uq` ON `products` (`slug`);--> statement-breakpoint
CREATE TABLE `settings` (
	`key` text PRIMARY KEY NOT NULL,
	`value` text DEFAULT '' NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
