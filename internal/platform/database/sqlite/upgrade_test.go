package db

import (
	"database/sql"
	"os"
	"path/filepath"
	orderdomain "shop/internal/modules/order/domain"
	"shop/internal/platform/database/sqlite/schema"
	"shop/internal/shared/clock"
	"testing"

	_ "modernc.org/sqlite"
)

// TestLegacyDBUpgradeKeepsData 版本兼容测试：用 001 初始 schema 建"旧库"并写入旧数据，
// 再用最新代码打开（跑完全部迁移），验证数据完整、状态回填正确、新表/版本记录齐全。
func TestLegacyDBUpgradeKeepsData(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "legacy.db")

	// 1) 用 001_init.sql 建旧库（不含后续任何迁移）
	initSQL, err := os.ReadFile(filepath.Join(schema.MigrationsRoot(), "001_init.sql"))
	if err != nil {
		t.Fatalf("read 001: %v", err)
	}
	d, err := sql.Open("sqlite", "file:"+path)
	if err != nil {
		t.Fatalf("open legacy: %v", err)
	}
	if _, err := d.Exec(string(initSQL)); err != nil {
		t.Fatalf("exec 001: %v", err)
	}
	now := clock.Now()
	// 2) 写入旧数据（旧状态值 pending、无 payment_status/view_token 列）
	if _, err := d.Exec(`INSERT INTO admins(id, username, password_hash, role, created_at) VALUES(1, 'legacy', 'x', 'admin', ?)`, now); err != nil {
		t.Fatalf("legacy admin: %v", err)
	}
	res, err := d.Exec(`INSERT INTO products(name, description, image_url, price_cents, status, category, sort_order, is_pinned, faq, wholesale, min_qty, max_qty, cost_cents, created_at, updated_at)
		VALUES('旧商品', '', '', 1000, 'active', '', 0, 0, '', '[]', 1, 100, 100, ?, ?)`, now, now)
	if err != nil {
		t.Fatalf("legacy product: %v", err)
	}
	pid, _ := res.LastInsertId()
	if _, err := d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, 'LEGACY-CARD', 'available', ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("legacy card: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, created_at, updated_at)
		VALUES('LEGACY-ORDER', ?, '旧商品', 1, 1000, 'CNY', 'usdt.trc20', 'a@b.com', 'pending', ?, ?)`, pid, now, now); err != nil {
		t.Fatalf("legacy order: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO settings(key, value, updated_at) VALUES('site_title', '旧站', ?)`, now); err != nil {
		t.Fatalf("legacy setting: %v", err)
	}
	d.Close()

	// 3) 用最新代码打开：跑完 002..023 全部迁移 + 配置迁移
	rd, err := Open(path)
	if err != nil {
		t.Fatalf("upgrade open: %v", err)
	}
	defer rd.Close()
	if !IntegrityOK(rd) {
		t.Fatal("legacy upgrade 后 PRAGMA integrity_check 未通过")
	}
	assertKeyIndexes(t, rd)

	// 4) 数据完整 + 回填正确
	var products, cards, orders int
	_ = rd.QueryRow(`SELECT COUNT(1) FROM products`).Scan(&products)
	_ = rd.QueryRow(`SELECT COUNT(1) FROM cards`).Scan(&cards)
	_ = rd.QueryRow(`SELECT COUNT(1) FROM orders`).Scan(&orders)
	if products != 1 || cards != 1 || orders != 1 {
		t.Fatalf("counts products=%d cards=%d orders=%d, want 1 each", products, cards, orders)
	}
	var status, payStatus, viewToken, siteTitle string
	_ = rd.QueryRow(`SELECT status, payment_status, view_token FROM orders WHERE order_no='LEGACY-ORDER'`).Scan(&status, &payStatus, &viewToken)
	if orderdomain.Status(status) != orderdomain.OrderWaitingPayment {
		t.Fatalf("legacy order status = %q, want waiting_payment (002 回填)", status)
	}
	if orderdomain.PaymentStatus(payStatus) != orderdomain.PaymentPending {
		t.Fatalf("legacy payment_status = %q, want pending (017 回填)", payStatus)
	}
	if viewToken == "" {
		t.Fatal("legacy order view_token must be backfilled (014)")
	}
	_ = rd.QueryRow(`SELECT value FROM settings WHERE key='site_title'`).Scan(&siteTitle)
	if siteTitle != "旧站" {
		t.Fatalf("settings value = %q, want 旧站", siteTitle)
	}

	// 5) 新表/版本记录齐全
	for _, tbl := range []string{"processed_events", "outbox_events", "settings_version", "job_runs", "dead_events"} {
		var n int
		if err := rd.QueryRow(`SELECT COUNT(1) FROM sqlite_master WHERE type='table' AND name=?`, tbl).Scan(&n); err != nil {
			t.Fatalf("check %s: %v", tbl, err)
		}
		if n == 0 {
			t.Fatalf("table %s missing after upgrade", tbl)
		}
	}
	files, _ := filepath.Glob(filepath.Join(schema.MigrationsRoot(), "*.sql"))
	var applied int
	_ = rd.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&applied)
	if applied != len(files) {
		t.Fatalf("applied migrations = %d, want %d", applied, len(files))
	}
}
