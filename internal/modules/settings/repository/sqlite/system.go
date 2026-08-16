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
		"order_logs", "cards", "orders", "products", "settings", "admins",
		"secrets", "sessions", "mail_queue", "outbox_events", "processed_events",
		"job_runs", "dead_events",
	}
	for _, t := range tables {
		if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s", t)); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM sqlite_sequence WHERE name IN ('products','cards','orders','mail_queue','outbox_events','job_runs','dead_events')`); err != nil {
		return err
	}
	return tx.Commit()
}

var _ = clock.Now
