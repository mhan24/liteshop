package schema

import (
	"database/sql"
	"strings"
	"testing"

	_ "modernc.org/sqlite"
)

func openTestDB(t *testing.T) *sql.DB {
	t.Helper()
	d, err := sql.Open("sqlite", "file:"+t.TempDir()+"/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	if err := Migrate(d); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return d
}

func TestMigrationSystemFreshDB(t *testing.T) {
	d := openTestDB(t)
	// 验证表齐全
	for _, tbl := range []string{"admins", "products", "cards", "orders", "order_logs", "audit_logs", "settings", "secrets", "sessions", "mail_queue", "schema_migrations"} {
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
	d1, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("first open: %v", err)
	}
	if err := Migrate(d1); err != nil {
		t.Fatalf("first migrate: %v", err)
	}
	d1.Close()
	// 二次打开应幂等成功
	d2, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("second open: %v", err)
	}
	defer d2.Close()
	if err := Migrate(d2); err != nil {
		t.Fatalf("second migrate: %v", err)
	}
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
	_ = d2.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('admins') WHERE name='totp_secret'`).Scan(&cols)
	if cols == 0 {
		t.Fatalf("admins.totp_secret missing after re-open")
	}
	_ = d2.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('orders') WHERE name='cost_cents'`).Scan(&cols)
	if cols == 0 {
		t.Fatalf("orders.cost_cents missing after re-open")
	}
	_ = d2.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('orders') WHERE name='view_token'`).Scan(&cols)
	if cols == 0 {
		t.Fatalf("orders.view_token missing after re-open")
	}
}

// TestAllMigrationsRecorded 验证每个迁移文件都按序记录。
func TestAllMigrationsRecorded(t *testing.T) {
	d := openTestDB(t)
	names := listMigrationFiles()
	var got int
	if err := d.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&got); err != nil {
		t.Fatalf("count: %v", err)
	}
	if got != len(names) {
		t.Fatalf("recorded %d migrations, want %d", got, len(names))
	}
	for _, n := range names {
		var c int
		_ = d.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, n).Scan(&c)
		if c == 0 {
			t.Fatalf("migration not recorded: %s", n)
		}
	}
}

// TestMigration007SQLIntegrity 验证 007 迁移 SQL 能被正确拆分且关键语句完整。
func TestMigration007SQLIntegrity(t *testing.T) {
	data, err := migrationFS.ReadFile("migrations/007_coupon_unique_and_backfill.sql")
	if err != nil {
		t.Fatalf("read 007: %v", err)
	}
	stmts := splitSQL(string(data))
	joined := strings.Join(stmts, " ")
	// 关键语句必须存在且完整
	for _, want := range []string{
		"UPDATE coupons", "used_count",
		"SELECT COUNT(*) FROM coupon_usages",
		"DELETE FROM coupon_usages",
		"DROP INDEX IF EXISTS idx_coupon_usage_order",
		"CREATE UNIQUE INDEX", "WHERE order_no <> ''",
		"UPDATE orders", "COALESCE(",
	} {
		if !strings.Contains(joined, want) {
			t.Fatalf("007 missing statement fragment: %q", want)
		}
	}
	// 拆分不应产生空语句或残缺尾部
	for _, s := range stmts {
		if strings.TrimSpace(s) == "" {
			t.Fatalf("007 produced empty statement")
		}
	}
	// 最后一条语句应完整结束（以分号拆分后最后仍非空为正常，此处验证无截断注释）
	if strings.Contains(stmts[len(stmts)-1], "--") {
		t.Fatalf("007 trailing comment leaked into SQL statement")
	}
}
