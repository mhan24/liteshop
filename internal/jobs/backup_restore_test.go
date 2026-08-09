package jobs

import (
	"os"
	"path/filepath"
	"testing"

	"shop/internal/db"
	"shop/internal/models"
)

// TestBackupRestoreDrill 备份恢复演练：备份 → 复制到新库 → 跑迁移 → 查询数据。
// 备份成功 ≠ 可恢复，必须端到端验证。
func TestBackupRestoreDrill(t *testing.T) {
	dir := t.TempDir()
	src := filepath.Join(dir, "shop.db")
	d, err := db.Open(src)
	if err != nil {
		t.Fatalf("open source: %v", err)
	}
	now := models.Now()
	res, err := d.Exec(`INSERT INTO products(name, description, price_cents, status, min_qty, max_qty, wholesale, created_at, updated_at)
		VALUES('恢复演练商品','',1000,'active',1,10,'[]',?,?)`, now, now)
	if err != nil {
		t.Fatalf("insert product: %v", err)
	}
	pid, _ := res.LastInsertId()
	_, _ = d.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, 'C1','available',?,?)`, pid, now, now)
	_, _ = d.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, cost_cents, cost_snapshot_source, fiat, trade_type, buyer_contact, view_token, status, payment_status, created_at, updated_at)
		VALUES('RESTORE-1', ?, '恢复演练商品', 1, 1000, 100, 'order_time', 'CNY', 'usdt.trc20', 'a@b.com', 'tok', 'paid', 'confirmed', ?, ?)`, pid, now, now)
	d.Close()

	run := BackupJob(src, 1)
	run()
	entries, err := os.ReadDir(filepath.Join(dir, "backups"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("backup entries: %v (%d)", err, len(entries))
	}
	backup := filepath.Join(dir, "backups", entries[0].Name())

	// 恢复演练：把备份复制到新库并重新打开（跑迁移），然后查询数据。
	restore := filepath.Join(dir, "restored.db")
	raw, err := os.ReadFile(backup)
	if err != nil {
		t.Fatalf("read backup: %v", err)
	}
	if err := os.WriteFile(restore, raw, 0o600); err != nil {
		t.Fatalf("write restore: %v", err)
	}
	rd, err := db.Open(restore)
	if err != nil {
		t.Fatalf("open restored db (migrations must replay): %v", err)
	}
	defer rd.Close()
	var products, cards, orders, migrations int
	_ = rd.QueryRow(`SELECT COUNT(1) FROM products`).Scan(&products)
	_ = rd.QueryRow(`SELECT COUNT(1) FROM cards`).Scan(&cards)
	_ = rd.QueryRow(`SELECT COUNT(1) FROM orders`).Scan(&orders)
	_ = rd.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&migrations)
	if products != 1 || cards != 1 || orders != 1 {
		t.Fatalf("restored counts: products=%d cards=%d orders=%d, want 1 each", products, cards, orders)
	}
	if migrations == 0 {
		t.Fatal("restored db missing migration records")
	}
}
