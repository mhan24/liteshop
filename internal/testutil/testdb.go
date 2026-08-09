// Package testutil 提供集成测试共享设施：SQLite 测试库、支付网关 mock、通知 recorder。
package testutil

import (
	"database/sql"
	"path/filepath"
	"time"

	"shop/internal/db"
	"shop/internal/models"
)

// testingTB 同时满足 *testing.T 与 *testing.B（基准测试复用同一套造数设施）。
type testingTB interface {
	Helper()
	TempDir() string
	Cleanup(func())
	Fatalf(format string, args ...any)
}

// NewTestDB 打开临时 SQLite 测试库（完成全部迁移），自动清理。
func NewTestDB(t testingTB) *sql.DB {
	t.Helper()
	d, err := db.Open(filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatalf("open test db: %v", err)
	}
	t.Cleanup(func() { d.Close() })
	return d
}

// SeedProductWithCards 建一个上架商品并插入 n 张可用卡密，返回商品 ID。
func SeedProductWithCards(t testingTB, d *sql.DB, n int) int64 {
	t.Helper()
	now := models.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, created_at, updated_at)
		VALUES('集成测试商品','',1000,'active',1,10,'[]',?,?)`, now, now)
	if err != nil {
		t.Fatalf("insert product: %v", err)
	}
	pid, err := res.LastInsertId()
	if err != nil {
		t.Fatalf("product id: %v", err)
	}
	for i := 0; i < n; i++ {
		if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?,'CARD-%d','available',?,?)`, pid, i+1, now, now); err != nil {
			t.Fatalf("insert card: %v", err)
		}
	}
	return pid
}

// SeedOrder 直接写入一笔订单（集成测试用），返回订单号。
func SeedOrder(t testingTB, d *sql.DB, productID int64, status, tradeID string) string {
	t.Helper()
	now := models.Now()
	orderNo := models.NewOrderNo()
	res, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, view_token, status, trade_id, created_at, updated_at)
		VALUES(?, ?, '集成测试商品', 1, 1000, 100, 'order_time', 'CNY', 'usdt.trc20', 'buyer@test.com', ?, ?, ?, ?, ?)`,
		orderNo, productID, models.RandomToken(24), status, tradeID, now, now)
	if err != nil {
		t.Fatalf("insert order: %v", err)
	}
	oid, _ := res.LastInsertId()
	// 预留一张卡密到该订单（模拟下单锁定），保证支付回调可直接发卡。
	var cardID int64
	_ = d.QueryRow(`SELECT id FROM cards WHERE product_id = ? AND status = 'available' ORDER BY id LIMIT 1`, productID).Scan(&cardID)
	if cardID > 0 {
		if _, err := d.Exec(`UPDATE cards SET reserved_order = ?, status = 'locked' WHERE id = ?`, oid, cardID); err != nil {
			t.Fatalf("reserve card: %v", err)
		}
	}
	return orderNo
}

// WaitFor 轮询等待条件成立（异步通知/网关调用使用）。
func WaitFor(t testingTB, timeout time.Duration, cond func() bool, msg string) {
	t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if cond() {
			return
		}
		time.Sleep(5 * time.Millisecond)
	}
	t.Fatalf("timeout waiting for: %s", msg)
}
