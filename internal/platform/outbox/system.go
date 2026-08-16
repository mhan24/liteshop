package outbox

import "database/sql"

// DeleteOldProcessedEvents 清理超过保留期的支付回调幂等台账（默认 90 天）。
// 订单进入终态后，晚到回调由条件状态迁移（WHERE status='waiting_payment'）兜底，
// 删除台账不会导致重复处理。
func DeleteOldProcessedEvents(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM processed_events WHERE processed_at < ?`, cutoff)
	return err
}

// DeleteOldDeadEvents 清理超过保留期的 outbox 死信事件（默认 90 天，保留足够排查窗口）。
func DeleteOldDeadEvents(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM dead_events WHERE dead_at < ?`, cutoff)
	return err
}
