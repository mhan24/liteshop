package integration

import (
	"testing"

	db "shop/internal/platform/database/sqlite"
	fixtures "shop/tests/fixtures"
)

// TestMigrationsApplyFreshDB 全新库迁移：核心表齐全、版本记录正确。
func TestMigrationsApplyFreshDB(t *testing.T) {
	d := fixtures.NewTestDB(t)
	for _, tbl := range []string{"admins", "products", "cards", "orders", "order_logs", "audit_logs", "settings", "secrets", "sessions", "mail_queue", "outbox_events", "processed_events", "schema_migrations"} {
		var n int
		if err := d.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&n); err != nil {
			t.Fatalf("query %s: %v", tbl, err)
		}
		if n != 1 {
			t.Fatalf("table %s missing", tbl)
		}
	}
	var migrations int
	if err := d.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&migrations); err != nil || migrations == 0 {
		t.Fatalf("schema_migrations = %d (%v), want > 0", migrations, err)
	}
	var sv int
	if err := d.QueryRow(`SELECT COALESCE(MAX(version),0) FROM settings_version`).Scan(&sv); err != nil || sv < 1 {
		t.Fatalf("settings_version = %d (%v), want >= 1", sv, err)
	}
}

// TestMigrationOpenPreservesData 已迁移库再次打开不重复迁移/不丢数据。
func TestMigrationOpenPreservesData(t *testing.T) {
	path := t.TempDir() + "/mig.db"
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	now := int64(1700000000)
	if _, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at) VALUES('保留商品','',1000,'active',1,100,'[]','auto',?,?)`, now, now); err != nil {
		t.Fatalf("insert: %v", err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	d2, err := db.Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer d2.Close()
	var n int
	if err := d2.QueryRow(`SELECT COUNT(1) FROM products`).Scan(&n); err != nil || n != 1 {
		t.Fatalf("products after reopen = %d (%v), want 1", n, err)
	}
}

// TestMigrationReRunIsNoop 已迁移库再次执行迁移为幂等 noop（不重复、不修改已发布迁移）。
func TestMigrationReRunIsNoop(t *testing.T) {
	path := t.TempDir() + "/rerun.db"
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	var before int
	if err := d.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&before); err != nil {
		t.Fatal(err)
	}
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	d2, err := db.Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer d2.Close()
	var after int
	if err := d2.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&after); err != nil {
		t.Fatal(err)
	}
	if after != before {
		t.Fatalf("schema_migrations changed on rerun: %d -> %d", before, after)
	}
}
