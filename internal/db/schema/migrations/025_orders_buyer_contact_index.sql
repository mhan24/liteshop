-- 025_orders_buyer_contact_index.sql - 邮箱订单查询索引
-- 前台"邮箱找回/发送查看链接"与管理端按邮箱搜索订单使用 buyer_contact，随订单增长需索引。
CREATE INDEX IF NOT EXISTS idx_orders_buyer_contact ON orders(buyer_contact, id);
