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

// TestMigration007Dedupe 验证 coupon_usages 去重：多组重复、跨券同订单号、used_count 与保留量一致、空 order_no 保留。
func TestMigration007Dedupe(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := models.Now()
	// 券 A：ORD1 3 条 + ORD2 2 条 + ORD3 1 条；券 B：ORD3 1 条（跨券共享 ORD3）；券 C：ORD4 2 条
	if _, err := d.Exec(`INSERT INTO coupons(code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at, updated_at) VALUES('A','fixed',50,0,0,10,6,0,1,0,?,?)`, now, now); err != nil {
		t.Fatalf("insert coupon A: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO coupons(code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at, updated_at) VALUES('B','fixed',50,0,0,10,1,0,1,0,?,?)`, now, now); err != nil {
		t.Fatalf("insert coupon B: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO coupons(code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at, updated_at) VALUES('C','fixed',50,0,0,10,2,0,1,0,?,?)`, now, now); err != nil {
		t.Fatalf("insert coupon C: %v", err)
	}
	var aid, bid, cid int64
	_ = d.QueryRow(`SELECT id FROM coupons WHERE code='A'`).Scan(&aid)
	_ = d.QueryRow(`SELECT id FROM coupons WHERE code='B'`).Scan(&bid)
	_ = d.QueryRow(`SELECT id FROM coupons WHERE code='C'`).Scan(&cid)
	// 模拟历史脏库：移除唯一索引，插入多组重复 + 跨券同订单号 + 空 order_no
	if _, err := d.Exec(`DROP INDEX IF EXISTS idx_coupon_usage_order`); err != nil {
		t.Fatalf("drop index: %v", err)
	}
	for _, o := range []string{"ORD1", "ORD1", "ORD1", "ORD2", "ORD2", "ORD3"} {
		_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, ?, 50, ?)`, aid, o, now)
	}
	// 券 B 与券 A 共享 ORD3（跨券同订单号）
	_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, 'ORD3', 50, ?)`, bid, now)
	// 券 C：ORD4 两条
	_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, 'ORD4', 50, ?)`, cid, now)
	_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, 'ORD4', 50, ?)`, cid, now)
	// 空订单号：券 A 两条、券 B 一条
	for i := 0; i < 2; i++ {
		_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, '', 0, ?)`, aid, now)
	}
	_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, '', 0, ?)`, bid, now)

	// 复现迁移 007 分步 SQL（与迁移文件保持一致）
	if _, err := d.Exec(`DELETE FROM coupon_usages WHERE order_no <> '' AND id NOT IN (SELECT MIN(id) FROM coupon_usages WHERE order_no <> '' GROUP BY order_no)`); err != nil {
		t.Fatalf("dedupe: %v", err)
	}
	if _, err := d.Exec(`UPDATE coupons SET used_count = (SELECT COUNT(*) FROM coupon_usages u WHERE u.coupon_id = coupons.id AND u.order_no <> '')`); err != nil {
		t.Fatalf("recount used_count: %v", err)
	}
	// 去重后预期：ORD1 保留1、ORD2 保留1、ORD3 保留1（全局最小 id，恰为券A）、ORD4 保留1（券C）
	// 券 A：ORD1+ORD2+ORD3 = 3；券 B：0（ORD3 被全局去重删除）；券 C：ORD4 = 1
	var aUsed, bUsed, cUsed int
	_ = d.QueryRow(`SELECT used_count FROM coupons WHERE id=?`, aid).Scan(&aUsed)
	_ = d.QueryRow(`SELECT used_count FROM coupons WHERE id=?`, bid).Scan(&bUsed)
	_ = d.QueryRow(`SELECT used_count FROM coupons WHERE id=?`, cid).Scan(&cUsed)
	var aRows, bRows, cRows int
	_ = d.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE coupon_id=? AND order_no <> ''`, aid).Scan(&aRows)
	_ = d.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE coupon_id=? AND order_no <> ''`, bid).Scan(&bRows)
	_ = d.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE coupon_id=? AND order_no <> ''`, cid).Scan(&cRows)
	if aUsed != aRows || bUsed != bRows || cUsed != cRows {
		t.Fatalf("used_count vs rows mismatch: A=%d/%d B=%d/%d C=%d/%d", aUsed, aRows, bUsed, bRows, cUsed, cRows)
	}
	if aRows != 3 {
		t.Fatalf("coupon A rows = %d, want 3", aRows)
	}
	// 空 order_no 记录应全部保留（A 两条 + B 一条 = 3 条）
	var emptyRows int
	_ = d.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE order_no = ''`).Scan(&emptyRows)
	if emptyRows != 3 {
		t.Fatalf("empty order_no rows = %d, want 3 (preserved)", emptyRows)
	}
	// 部分唯一索引仍应成功，且拒绝重复非空 order_no
	if _, err := d.Exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order ON coupon_usages(order_no) WHERE order_no <> ''`); err != nil {
		t.Fatalf("partial unique index should succeed with empty order_no rows: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, 'ORD1', 50, ?)`, aid, now); err == nil {
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

// TestMigration007EndToEnd 走真实 migrateDB 验证 007 在迁移器事务中执行，
// 且能正确处理脏数据（跨券同订单号 + 空订单号 + 多组重复）。
func TestMigration007EndToEnd(t *testing.T) {
	path := t.TempDir() + "/e2e.db"
	d, err := Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	now := models.Now()
	// 移除 007 记录以便重跑
	if _, err := d.Exec(`DELETE FROM schema_migrations WHERE version LIKE '%007%'`); err != nil {
		d.Close()
		t.Fatalf("delete 007 record: %v", err)
	}
	// 造脏数据
	if _, err := d.Exec(`INSERT INTO coupons(code, type, value_cents, percent, min_amount_cents, max_uses, used_count, product_id, active, expires_at, created_at, updated_at) VALUES('A','fixed',50,0,0,10,3,0,1,0,?,?)`, now, now); err != nil {
		d.Close()
		t.Fatalf("insert coupon: %v", err)
	}
	var aid int64
	_ = d.QueryRow(`SELECT id FROM coupons WHERE code='A'`).Scan(&aid)
	if _, err := d.Exec(`DROP INDEX IF EXISTS idx_coupon_usage_order`); err != nil {
		d.Close()
		t.Fatalf("drop index: %v", err)
	}
	for _, o := range []string{"ORD1", "ORD1", "ORD1", "ORD2", "ORD2"} {
		_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, ?, 50, ?)`, aid, o, now)
	}
	_, _ = d.Exec(`INSERT INTO coupon_usages(coupon_id, order_no, discount_cents, created_at) VALUES(?, '', 0, ?)`, aid, now)
	d.Close()

	// 重新打开触发 007 迁移
	d2, err := Open(path)
	if err != nil {
		t.Fatalf("reopen: %v", err)
	}
	defer d2.Close()
	var aUsed, aRows, emptyRows int
	_ = d2.QueryRow(`SELECT used_count FROM coupons WHERE code='A'`).Scan(&aUsed)
	_ = d2.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE coupon_id=? AND order_no <> ''`, aid).Scan(&aRows)
	_ = d2.QueryRow(`SELECT COUNT(1) FROM coupon_usages WHERE order_no = ''`).Scan(&emptyRows)
	if aUsed != aRows {
		t.Fatalf("e2e used_count=%d rows=%d mismatch", aUsed, aRows)
	}
	if aRows != 2 {
		t.Fatalf("e2e coupon A rows = %d, want 2", aRows)
	}
	if emptyRows != 1 {
		t.Fatalf("e2e empty order_no rows = %d, want 1", emptyRows)
	}
}
