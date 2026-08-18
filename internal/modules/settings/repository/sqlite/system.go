package sqlite

import (
	"database/sql"
	"fmt"
	"shop/internal/shared/clock"
)

// ResetAllTables 清空业务数据（恢复/重置用，不删除表结构）。
func ResetAllTables(d *sql.DB) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tables := []string{
		"order_logs", "cards", "orders", "products", "coupons", "coupon_usages",
		"audit_logs", "low_stock_reminders", "admins", "secrets", "sessions",
		"mail_queue", "outbox_events", "processed_events", "job_runs", "dead_events",
	}
	// session_secret 是数据库加密根密钥，必须跨“重置并重新初始化”保留，
	// 否则本次进程用旧密钥写入的 secrets 会在重启后无法解密。
	if _, err := tx.Exec(`DELETE FROM settings WHERE key != 'session_secret'`); err != nil {
		return err
	}
	for _, t := range tables {
		if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s", t)); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM sqlite_sequence WHERE name IN ('products','cards','orders','coupons','coupon_usages','audit_logs','mail_queue','outbox_events','job_runs','dead_events')`); err != nil {
		return err
	}
	return tx.Commit()
}

var _ = clock.Now
