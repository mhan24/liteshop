-- 027_add_payment_gateway.sql - 订单记录支付网关
-- 双网关并存：每个订单记录用户选择的网关（bepusdt / hashpay），
-- 回调按网关分别处理、幂等键按网关区分；存量订单默认回填 bepusdt。
ALTER TABLE orders ADD COLUMN payment_gateway TEXT NOT NULL DEFAULT 'bepusdt';
