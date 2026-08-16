-- 008: 订单成本来源标注（区分下单时真实快照与迁移估算）
ALTER TABLE orders ADD COLUMN cost_snapshot_source TEXT NOT NULL DEFAULT 'unknown';
UPDATE orders SET cost_snapshot_source = 'migration_estimate' WHERE cost_cents > 0;
