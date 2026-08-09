-- 019_release_payment_failed_cards.sql - 历史遗留清理
-- 旧版本"创建支付交易失败"路径未释放锁定卡密，这里把 payment_failed 订单
-- 残留的 locked 卡密释放回可用库存（幂等：无残留则不影响任何行）。
UPDATE cards
SET status = 'available', reserved_order = 0, updated_at = CAST(strftime('%s','now') AS INTEGER)
WHERE status = 'locked'
  AND reserved_order IN (SELECT id FROM orders WHERE status = 'payment_failed');
