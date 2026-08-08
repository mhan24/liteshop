-- 009_order_view_token.sql - 订单查看令牌
ALTER TABLE orders ADD COLUMN view_token TEXT NOT NULL DEFAULT '';
