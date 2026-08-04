package db

import (
	"testing"
)

func TestMigrationSystemFreshDB(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	// 验证表齐全
	for _, tbl := range []string{"admins", "products", "cards", "orders", "order_logs", "audit_logs", "settings", "schema_migrations"} {
		var n int
		if err := d.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&n); err != nil {
			t.Fatalf("query %s: %v", tbl, err)
		}
		if n == 0 {
			t.Fatalf("table %s missing after fresh migrate", tbl)
		}
	}
	// 验证迁移版本已记录
	var v string
	if err := d.QueryRow(`SELECT version FROM schema_migrations WHERE version LIKE '%001%'`).Scan(&v); err != nil {
		t.Fatalf("001 migration not recorded: %v", err)
	}
	var v2 string
	if err := d.QueryRow(`SELECT version FROM schema_migrations WHERE version LIKE '%002%'`).Scan(&v2); err != nil {
		t.Fatalf("002 migration not recorded: %v", err)
	}
}

func TestMigrationIdempotent(t *testing.T) {
	path := t.TempDir() + "/test.db"
	d1, err := Open(path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	d1.Close()
	// 二次打开应幂等成功
	d2, err := Open(path)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	defer d2.Close()
	// 表结构验证
	var cols int
	_ = d2.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('cards') WHERE name='reserved_order'`).Scan(&cols)
	if cols == 0 {
		t.Fatalf("cards.reserved_order missing after re-open")
	}
	_ = d2.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('products') WHERE name='faq'`).Scan(&cols)
	if cols == 0 {
		t.Fatalf("products.faq missing after re-open")
	}
}
