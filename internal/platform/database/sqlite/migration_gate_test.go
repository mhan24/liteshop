package db

import (
	"database/sql"
	"path/filepath"
	"strings"
	"testing"

	"shop/internal/models"
	"shop/internal/platform/database/sqlite/schema"
)

// keyIndexes 迁移门禁必须存在的关键索引（订单/卡密/日志/审计/事件/会话/券查询基线）。
// 新增查询必须走这些索引；新增索引后请同步加入此清单。
var keyIndexes = []string{
	"idx_cards_product_status",  // 卡密按商品+状态查询
	"idx_cards_reserved_order",  // 订单锁定卡密回查
	"idx_cards_sold_order",      // 已售卡密归属回查
	"idx_orders_status",         // 状态批量任务（过期/统计）
	"idx_orders_buyer_contact",  // 邮箱查单
	"idx_order_logs_order",      // 订单日志回放
	"idx_audit_logs_admin_time", // 审计查询基线（admin_id, id）
	"idx_outbox_pending",        // outbox worker 拉取
	"idx_sessions_expires",      // 会话过期清理
	"idx_coupons_code",          // 优惠券按码查询
}

func assertKeyIndexes(t *testing.T, d *sql.DB) {
	t.Helper()
	for _, idx := range keyIndexes {
		var n int
		if err := d.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type='index' AND name=?`, idx).Scan(&n); err != nil {
			t.Fatalf("查询索引 %s: %v", idx, err)
		}
		if n != 1 {
			t.Fatalf("关键索引 %s 缺失", idx)
		}
	}
}

// TestMigrationGateFreshDB 空数据库执行全部迁移：integrity_check 通过、关键索引齐全、
// 迁移版本数正确、迁移后基本查询正常。
func TestMigrationGateFreshDB(t *testing.T) {
	d, err := Open(t.TempDir() + "/fresh.db")
	if err != nil {
		t.Fatalf("打开空库: %v", err)
	}
	defer d.Close()

	if !IntegrityOK(d) {
		t.Fatal("空库迁移后 PRAGMA integrity_check 未通过")
	}
	assertKeyIndexes(t, d)

	files, _ := filepath.Glob(filepath.Join(schema.MigrationsRoot(), "*.sql"))
	var applied int
	_ = d.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&applied)
	if applied != len(files) {
		t.Fatalf("已应用迁移 = %d, 迁移文件 = %d", applied, len(files))
	}

	// 迁移后基本查询：商品 + 卡密 + 订单 的联合查询正常。
	now := models.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at)
		VALUES('迁移商品','',100,'active',1,100,'[]','auto',?,?)`, now, now)
	if err != nil {
		t.Fatalf("插入商品: %v", err)
	}
	pid, _ := res.LastInsertId()
	if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, 'CARD-1', 'available', ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("插入卡密: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, created_at, updated_at)
		VALUES('MIG-ORDER', ?, '迁移商品', 1, 100, 'CNY', 'usdt.trc20', 'a@b.com', 'waiting_payment', ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("插入订单: %v", err)
	}
	var cards, orders int
	_ = d.QueryRow(`SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'available'`, pid).Scan(&cards)
	_ = d.QueryRow(`SELECT COUNT(1) FROM orders WHERE product_id = ?`, pid).Scan(&orders)
	if cards != 1 || orders != 1 {
		t.Fatalf("基本查询结果 cards=%d orders=%d, want 1/1", cards, orders)
	}
	var orderNo string
	if err := d.QueryRow(`SELECT o.order_no FROM orders o JOIN products p ON p.id = o.product_id WHERE o.product_id = ?`, pid).Scan(&orderNo); err != nil || orderNo != "MIG-ORDER" {
		t.Fatalf("商品订单联合查询: order_no=%q err=%v", orderNo, err)
	}
}

// TestMigrationGateIndexLookup 验证关键索引确实被查询优化器使用（EXPLAIN QUERY PLAN 走索引）。
func TestMigrationGateIndexLookup(t *testing.T) {
	d, err := Open(t.TempDir() + "/idx.db")
	if err != nil {
		t.Fatalf("打开库: %v", err)
	}
	defer d.Close()

	now := models.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, delivery_type, created_at, updated_at)
		VALUES('p','',100,'active',1,100,'[]','auto',?,?)`, now, now)
	if err != nil {
		t.Fatalf("插入商品: %v", err)
	}
	pid, _ := res.LastInsertId()
	// 灌入少量数据让 planner 有选择空间
	for i := 0; i < 50; i++ {
		if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, 'C', 'available', ?, ?)`, pid, now, now); err != nil {
			t.Fatalf("插入卡密: %v", err)
		}
	}
	rows, err := d.Query(`EXPLAIN QUERY PLAN SELECT COUNT(1) FROM cards WHERE product_id = ? AND status = 'available'`, pid)
	if err != nil {
		t.Fatalf("explain: %v", err)
	}
	defer rows.Close()
	plan := ""
	for rows.Next() {
		var id, parent, notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatalf("scan explain: %v", err)
		}
		plan += detail + " "
	}
	if !strings.Contains(plan, "idx_cards_product_status") {
		t.Fatalf("卡密查询未走 idx_cards_product_status，plan=%q", plan)
	}
}
