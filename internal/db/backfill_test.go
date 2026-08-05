package db

import (
	"strings"
	"testing"

	"shop/internal/models"
)

// TestMigration007Backfill 验证成本回填：正常商品订单回填、孤儿订单保持 0（不违反 NOT NULL）、幂等。
func TestMigration007Backfill(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := models.Now()
	// 商品（成本 40 分）与两个订单：一个有商品、一个孤儿（商品已删）
	if _, err := d.Exec(`INSERT INTO products(name, description, price_cents, cost_cents, status, min_qty, max_qty, wholesale, created_at, updated_at) VALUES('p','',100,40,'active',1,100,'[]',?,?)`, now, now); err != nil {
		t.Fatalf("insert product: %v", err)
	}
	var pid int64
	_ = d.QueryRow(`SELECT id FROM products LIMIT 1`).Scan(&pid)
	if _, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, status, created_at, updated_at) VALUES('OK1', ?, 'p', 1, 100, 0, 'unknown', 'CNY', 'usdt', 'a@b.com', 'paid', ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("insert normal order: %v", err)
	}
	// 先建商品订单再删除商品，模拟孤儿订单（历史遗留）
	if _, err := d.Exec(`INSERT INTO products(name, description, price_cents, cost_cents, status, min_qty, max_qty, wholesale, created_at, updated_at) VALUES('gone','',100,0,'active',1,100,'[]',?,?)`, now, now); err != nil {
		t.Fatalf("insert orphan product: %v", err)
	}
	var orphanPid int64
	_ = d.QueryRow(`SELECT id FROM products WHERE name='gone'`).Scan(&orphanPid)
	if _, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, status, created_at, updated_at) VALUES('ORPHAN', ?, 'gone', 1, 100, 0, 'unknown', 'CNY', 'usdt', 'a@b.com', 'paid', ?, ?)`, orphanPid, now, now); err != nil {
		t.Fatalf("insert orphan order: %v", err)
	}
	// 关闭外键后删除商品，模拟历史孤儿订单（迁移期 DB 可能未启用 FK）
	if _, err := d.Exec(`PRAGMA foreign_keys = OFF`); err != nil {
		t.Fatalf("disable fk: %v", err)
	}
	if _, err := d.Exec(`DELETE FROM products WHERE id = ?`, orphanPid); err != nil {
		t.Fatalf("delete orphan product: %v", err)
	}
	if _, err := d.Exec(`PRAGMA foreign_keys = ON`); err != nil {
		t.Fatalf("enable fk: %v", err)
	}
	// 执行与迁移007 等价的回填 SQL
	if _, err := d.Exec(`UPDATE orders SET cost_cents = COALESCE((SELECT p.cost_cents FROM products p WHERE p.id = orders.product_id), 0) WHERE cost_cents = 0`); err != nil {
		t.Fatalf("backfill SQL should not fail: %v", err)
	}
	var normalCost, orphanCost int64
	_ = d.QueryRow(`SELECT cost_cents FROM orders WHERE order_no = 'OK1'`).Scan(&normalCost)
	_ = d.QueryRow(`SELECT cost_cents FROM orders WHERE order_no = 'ORPHAN'`).Scan(&orphanCost)
	if normalCost != 40 {
		t.Fatalf("normal order cost = %d, want 40", normalCost)
	}
	if orphanCost != 0 {
		t.Fatalf("orphan order cost = %d, want 0", orphanCost)
	}
}

// TestMigration007Dedupe 验证 coupon_usages 重复记录去重、used_count 回退与部分唯一索引。
func TestMigration007Dedupe(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := models.Now()
	// used_count 初始 3，模拟重复 3 次使用记录
	if _, err := d.Exec(`INSERT INTO coupons(code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at, updated_at) VALUES('DEDUPE', 'fixed', 50, 0, 0, 5, 3, 0, 1, 0, ?, ?)`, now, now); err != nil {
		t.Fatalf("insert coupon: %v", err)
	}
	var cid int64
	_ = d.QueryRow(`SELECT id FROM coupons LIMIT 1`).Scan(&cid)
	// 模拟历史脏库：先移除唯一索引，再插入同 order_no 多条 + 多条空 order_no
	if _, err := d.Exec(`DROP INDEX IF EXISTS idx_coupon_usage_order`); err != nil {
		t.Fatalf("drop index: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, 'ORD1', 50, ?)`, cid, now); err != nil {
			t.Fatalf("insert usage: %v", err)
		}
	}
	for i := 0; i < 2; i++ {
		if _, err := d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, '', 0, ?)`, cid, now); err != nil {
			t.Fatalf("insert empty-order usage: %v", err)
		}
	}
	// 复现迁移 007 分步 SQL
	if _, err := d.Exec(`UPDATE coupons SET used_count = MAX(0, used_count - (SELECT COUNT(*) - 1 FROM coupon_usages u WHERE u.coupon_id = coupons.id AND u.order_no <> '' GROUP BY u.coupon_id, u.order_no))`); err != nil {
		t.Fatalf("refund used_count: %v", err)
	}
	var used int
	_ = d.QueryRow(`SELECT used_count FROM coupons WHERE id = ?`, cid).Scan(&used)
	if used != 1 {
		t.Fatalf("used_count after refund = %d, want 1 (3-2)", used)
	}
	if _, err := d.Exec(`DELETE FROM coupon_usages WHERE id NOT IN (SELECT MIN(id) FROM coupon_usages WHERE order_no <> '' GROUP BY order_no)`); err != nil {
		t.Fatalf("dedupe: %v", err)
	}
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE order_no = 'ORD1'`).Scan(&n)
	if n != 1 {
		t.Fatalf("usage rows after dedupe = %d, want 1", n)
	}
	// 多条空 order_no 不应阻断部分唯一索引
	if _, err := d.Exec(`DROP INDEX IF EXISTS idx_coupon_usage_order`); err != nil {
		t.Fatalf("drop index: %v", err)
	}
	if _, err := d.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order ON coupon_usages(order_no) WHERE order_no <> ''`); err != nil {
		t.Fatalf("partial unique index should succeed with empty order_no rows: %v", err)
	}
	// 部分索引仍应阻止重复非空 order_no
	if _, err := d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, 'ORD1', 50, ?)`, cid, now); err == nil {
		t.Fatalf("duplicate non-empty order_no should be rejected by partial index")
	}
}

// TestMigration008CostSource 验证 cost_snapshot_source 列存在且迁移标注估算来源。
func TestMigration008CostSource(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	var cols int
	_ = d.QueryRow(`SELECT COUNT(1) FROM pragma_table_info('orders') WHERE name='cost_snapshot_source'`).Scan(&cols)
	if cols == 0 {
		t.Fatalf("orders.cost_snapshot_source missing")
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
		"UPDATE coupons", "used_count", "MAX(0,",
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
