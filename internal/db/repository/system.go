package repository

import (
	"database/sql"
	"fmt"
)

// SchemaVersion 返回已应用的 schema 迁移数量（作为版本指示）。
func SchemaVersion(d *sql.DB) int {
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&n)
	return n
}

// IntegrityOK 对主库执行 PRAGMA integrity_check，返回是否完整。
func IntegrityOK(d *sql.DB) bool {
	var result string
	if err := d.QueryRow(`PRAGMA integrity_check`).Scan(&result); err != nil {
		return false
	}
	return result == "ok"
}

// ResetAllTables 清空业务数据（恢复/重置用，不删除表结构）。
func ResetAllTables(d *sql.DB) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	// 清空业务数据与运行时表；settings_version（配置版本）与 schema_migrations 保留。
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
