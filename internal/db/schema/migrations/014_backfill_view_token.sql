-- 014_backfill_view_token.sql - 存量订单回填查看令牌
-- 关闭"邮箱+订单号"兼容访问：所有订单一律凭查看令牌访问卡密/取消。
UPDATE orders SET view_token = lower(hex(randomblob(16))) WHERE view_token = '' OR view_token IS NULL;
