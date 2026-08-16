package db

import "database/sql"

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
