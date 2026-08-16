-- 017_add_payment_status.sql - 支付状态独立（订单状态 ≠ 支付状态）
--
-- 新增 payment_status 列，按存量订单状态回填支付生命周期：
--   created -> created / waiting_payment -> pending / paid|processing|delivered|completed -> confirmed
--   payment_failed -> failed / cancelled|expired -> cancelled
ALTER TABLE orders ADD COLUMN payment_status TEXT NOT NULL DEFAULT '';

UPDATE orders SET payment_status = CASE status
    WHEN 'created' THEN 'created'
    WHEN 'waiting_payment' THEN 'pending'
    WHEN 'paid' THEN 'confirmed'
    WHEN 'processing' THEN 'confirmed'
    WHEN 'delivered' THEN 'confirmed'
    WHEN 'completed' THEN 'confirmed'
    WHEN 'payment_failed' THEN 'failed'
    WHEN 'cancelled' THEN 'cancelled'
    WHEN 'expired' THEN 'cancelled'
    ELSE 'created'
END;
