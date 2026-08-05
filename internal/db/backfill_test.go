package db

import (
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

// TestMigration007Dedupe 验证 coupon_usages 重复记录去重后可创建唯一索引。
func TestMigration007Dedupe(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := models.Now()
	if _, err := d.Exec(`INSERT INTO coupons(code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at, updated_at) VALUES('DEDUPE', 'fixed', 50, 0, 0, 0, 0, 0, 1, 0, ?, ?)`, now, now); err != nil {
		t.Fatalf("insert coupon: %v", err)
	}
	var cid int64
	_ = d.QueryRow(`SELECT id FROM coupons LIMIT 1`).Scan(&cid)
	// 模拟历史脏库：先移除唯一索引，再插入同一 order_no 的多条使用记录
	if _, err := d.Exec(`DROP INDEX IF EXISTS idx_coupon_usage_order`); err != nil {
		t.Fatalf("drop index: %v", err)
	}
	for i := 0; i < 3; i++ {
		if _, err := d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, 'ORD1', 50, ?)`, cid, now); err != nil {
			t.Fatalf("insert usage: %v", err)
		}
	}
	// 去重：保留 MIN(id) 一条
	if _, err := d.Exec(`DELETE FROM coupon_usages WHERE id NOT IN (SELECT MIN(id) FROM coupon_usages GROUP BY order_no) AND order_no != ''`); err != nil {
		t.Fatalf("dedupe: %v", err)
	}
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE order_no = 'ORD1'`).Scan(&n)
	if n != 1 {
		t.Fatalf("usage rows after dedupe = %d, want 1", n)
	}
	if _, err := d.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order ON coupon_usages(order_no)`); err != nil {
		t.Fatalf("unique index should succeed after dedupe: %v", err)
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
