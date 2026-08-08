package repository

import (
	"database/sql"
	"fmt"
)

// ResetAllTables 清空业务数据（恢复/重置用，不删除表结构）。
func ResetAllTables(d *sql.DB) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tables := []string{"order_logs", "cards", "orders", "products", "settings", "admins"}
	for _, t := range tables {
		if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s", t)); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM sqlite_sequence WHERE name IN ('products','cards','orders')`); err != nil {
		return err
	}
	return tx.Commit()
}
