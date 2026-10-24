CREATE TABLE "admins" (
	"id" serial PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admins_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "audit_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"detail" text,
	"ip" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "cards" (
	"id" serial PRIMARY KEY NOT NULL,
	"product_id" integer NOT NULL,
	"content" text NOT NULL,
	"status" text DEFAULT 'available' NOT NULL,
	"reserved_order_id" uuid,
	"sold_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "categories" (
	"id" serial PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "categories_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "deliveries" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"content" text NOT NULL,
	"card_ids" jsonb NOT NULL,
	"email_attempts" integer DEFAULT 0 NOT NULL,
	"email_sent_at" timestamp with time zone,
	"email_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "deliveries_order_id_unique" UNIQUE("order_id")
);
--> statement-breakpoint
CREATE TABLE "notify_logs" (
	"id" serial PRIMARY KEY NOT NULL,
	"channel_key" text NOT NULL,
	"order_no" text,
	"provider_ref" text,
	"payload_hash" text NOT NULL,
	"payload" text NOT NULL,
	"handled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "order_items" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"product_id" integer,
	"product_name" text NOT NULL,
	"unit_price_cents" bigint NOT NULL,
	"quantity" integer NOT NULL,
	"line_total_cents" bigint NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"order_no" text NOT NULL,
	"email" text NOT NULL,
	"query_password_hash" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"currency" text NOT NULL,
	"subtotal_cents" bigint NOT NULL,
	"total_cents" bigint NOT NULL,
	"note" text,
	"expires_at" timestamp with time zone,
	"paid_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "orders_order_no_unique" UNIQUE("order_no")
);
--> statement-breakpoint
CREATE TABLE "payment_channels" (
	"id" serial PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"api_base" text,
	"token_enc" text,
	"currencies" text,
	"timeout_seconds" integer DEFAULT 600 NOT NULL,
	"reselect" boolean DEFAULT true NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"enabled" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "payment_channels_key_unique" UNIQUE("key")
);
--> statement-breakpoint
CREATE TABLE "payments" (
	"id" serial PRIMARY KEY NOT NULL,
	"order_id" uuid NOT NULL,
	"channel_id" integer NOT NULL,
	"provider_ref" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_current" boolean DEFAULT true NOT NULL,
	"amount_cents" bigint NOT NULL,
	"currency" text NOT NULL,
	"expected_amount" text,
	"payment_url" text,
	"anomaly" text,
	"raw" jsonb,
	"confirmed_at" timestamp with time zone,
	"expires_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "products" (
	"id" serial PRIMARY KEY NOT NULL,
	"category_id" integer,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"price_cents" bigint NOT NULL,
	"delivery_type" text NOT NULL,
	"stock_limit" integer,
	"status" text DEFAULT 'on' NOT NULL,
	"image_url" text,
	"seo_description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "products_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cards" ADD CONSTRAINT "cards_reserved_order_id_orders_id_fk" FOREIGN KEY ("reserved_order_id") REFERENCES "public"."orders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deliveries" ADD CONSTRAINT "deliveries_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "order_items" ADD CONSTRAINT "order_items_product_id_products_id_fk" FOREIGN KEY ("product_id") REFERENCES "public"."products"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_order_id_orders_id_fk" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payments" ADD CONSTRAINT "payments_channel_id_payment_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."payment_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_category_id_categories_id_fk" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_logs_created_idx" ON "audit_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "cards_product_status_idx" ON "cards" USING btree ("product_id","status");--> statement-breakpoint
CREATE INDEX "cards_reserved_order_idx" ON "cards" USING btree ("reserved_order_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cards_product_content_uq" ON "cards" USING btree ("product_id","content");--> statement-breakpoint
CREATE INDEX "deliveries_email_pending_idx" ON "deliveries" USING btree ("email_sent_at","email_attempts");--> statement-breakpoint
CREATE INDEX "notify_logs_hash_idx" ON "notify_logs" USING btree ("payload_hash");--> statement-breakpoint
CREATE INDEX "notify_logs_created_idx" ON "notify_logs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "order_items_order_idx" ON "order_items" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "orders_email_idx" ON "orders" USING btree ("email");--> statement-breakpoint
CREATE INDEX "orders_status_expires_idx" ON "orders" USING btree ("status","expires_at");--> statement-breakpoint
CREATE INDEX "orders_created_idx" ON "orders" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "payments_channel_ref_uq" ON "payments" USING btree ("channel_id","provider_ref") WHERE provider_ref is not null;--> statement-breakpoint
CREATE INDEX "payments_order_idx" ON "payments" USING btree ("order_id");--> statement-breakpoint
CREATE INDEX "payments_current_idx" ON "payments" USING btree ("order_id","is_current");--> statement-breakpoint
CREATE INDEX "products_category_idx" ON "products" USING btree ("category_id");--> statement-breakpoint
CREATE INDEX "products_status_idx" ON "products" USING btree ("status");