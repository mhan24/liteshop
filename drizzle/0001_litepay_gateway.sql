-- 破坏性重构：单一 LitePay 网关 + 只有卡密自动发货 + USD 单币种。
-- 1) 支付渠道表整体下线，支付记录直接记网关标识（litepay / mock）
-- 2) 商品不再区分发货方式，库存 = 可用卡密数量
-- 3) 订单与支付记录不再保存币种（全站 USD）
ALTER TABLE "payments" DROP CONSTRAINT "payments_channel_id_payment_channels_id_fk";--> statement-breakpoint
DROP INDEX "payments_channel_ref_uq";--> statement-breakpoint
ALTER TABLE "payments" ADD COLUMN "channel" text DEFAULT 'litepay' NOT NULL;--> statement-breakpoint
ALTER TABLE "payments" ALTER COLUMN "channel" DROP DEFAULT;--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "channel_id";--> statement-breakpoint
ALTER TABLE "payments" DROP COLUMN "currency";--> statement-breakpoint
DROP TABLE "payment_channels" CASCADE;--> statement-breakpoint
CREATE UNIQUE INDEX "payments_channel_ref_uq" ON "payments" USING btree ("channel","provider_ref") WHERE provider_ref is not null;--> statement-breakpoint
ALTER TABLE "notify_logs" RENAME COLUMN "channel_key" TO "channel";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "delivery_type";--> statement-breakpoint
ALTER TABLE "products" DROP COLUMN "stock_limit";--> statement-breakpoint
ALTER TABLE "orders" DROP COLUMN "currency";
