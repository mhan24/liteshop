package db

import (
	"database/sql"
	"fmt"
	"strings"

	"shop/internal/models"

	_ "modernc.org/sqlite"
)

func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if err := db.Ping(); err != nil {
		return nil, err
	}
	if err := migrate(db); err != nil {
		return nil, err
	}
	return db, nil
}

func migrate(db *sql.DB) error {
	stmts := []string{
		`CREATE TABLE IF NOT EXISTS admins (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			username TEXT NOT NULL UNIQUE,
			password_hash TEXT NOT NULL,
			role TEXT NOT NULL DEFAULT 'operator',
			created_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS products (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			name TEXT NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			image_url TEXT NOT NULL DEFAULT '',
			price_cents INTEGER NOT NULL,
			status TEXT NOT NULL DEFAULT 'active',
			category TEXT NOT NULL DEFAULT '',
			sort_order INTEGER NOT NULL DEFAULT 0,
			is_pinned INTEGER NOT NULL DEFAULT 0,
			faq TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS cards (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL REFERENCES products(id),
			reserved_order INTEGER NOT NULL DEFAULT 0,
			sold_order INTEGER NOT NULL DEFAULT 0,
			content TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'available',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			sold_at INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id, status);`,
		`CREATE TABLE IF NOT EXISTS orders (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			order_no TEXT NOT NULL UNIQUE,
			product_id INTEGER NOT NULL REFERENCES products(id),
			product_name TEXT NOT NULL,
			qty INTEGER NOT NULL,
			amount_cents INTEGER NOT NULL,
			fiat TEXT NOT NULL,
			trade_type TEXT NOT NULL,
			buyer_contact TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'pending',
			trade_id TEXT NOT NULL DEFAULT '',
			payment_url TEXT NOT NULL DEFAULT '',
			block_transaction_id TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			paid_at INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);`,
		`CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);`,
		`CREATE TABLE IF NOT EXISTS order_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			order_id INTEGER NOT NULL REFERENCES orders(id),
			event TEXT NOT NULL,
			message TEXT NOT NULL DEFAULT '',
			from_status TEXT NOT NULL DEFAULT '',
			to_status TEXT NOT NULL DEFAULT '',
			admin_id INTEGER NOT NULL DEFAULT 0,
			metadata TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_order_logs_order ON order_logs(order_id, id);`,
		`CREATE TABLE IF NOT EXISTS audit_logs (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			admin_id INTEGER NOT NULL DEFAULT 0,
			username TEXT NOT NULL DEFAULT '',
			action TEXT NOT NULL,
			target_type TEXT NOT NULL DEFAULT '',
			target_id TEXT NOT NULL DEFAULT '',
			before_value TEXT NOT NULL DEFAULT '',
			after_value TEXT NOT NULL DEFAULT '',
			created_at INTEGER NOT NULL
		);`,
		`CREATE INDEX IF NOT EXISTS idx_audit_logs_time ON audit_logs(id);`,
		`CREATE TABLE IF NOT EXISTS settings (
			key TEXT PRIMARY KEY,
			value TEXT NOT NULL DEFAULT '',
			updated_at INTEGER NOT NULL
		);`,
	}
	for _, stmt := range stmts {
		if _, err := db.Exec(stmt); err != nil {
			return err
		}
	}
	if err := ensureProductColumns(db); err != nil {
		return err
	}
	if err := ensureCardColumns(db); err != nil {
		return err
	}
	if err := ensureAdminColumns(db); err != nil {
		return err
	}
	if err := backfillOrderStatuses(db); err != nil {
		return err
	}
	return nil
}

// ensureAdminColumns 为旧版单管理员表补充 role 列并支持多管理员。
// 旧表带 CHECK(id=1) 约束，无法加列或插多行，需重建表。
func ensureAdminColumns(db *sql.DB) error {
	// 检测是否为旧式单管理员表（含 CHECK(id=1) 或无 role 列）
	var sql0 string
	_ = db.QueryRow(`SELECT sql FROM sqlite_master WHERE type='table' AND name='admins'`).Scan(&sql0)
	legacy := strings.Contains(sql0, "CHECK (id = 1)")
	if hasRole, _ := columnExists(db, "admins", "role"); !hasRole {
		legacy = true
	}
	if legacy {
		if err := rebuildAdminsTable(db); err != nil {
			return err
		}
	}
	if _, err := db.Exec(`UPDATE admins SET role = 'admin' WHERE id = 1`); err != nil {
		return err
	}
	return nil
}

func rebuildAdminsTable(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`CREATE TABLE admins_new (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		username TEXT NOT NULL UNIQUE,
		password_hash TEXT NOT NULL,
		role TEXT NOT NULL DEFAULT 'operator',
		created_at INTEGER NOT NULL
	)`); err != nil {
		return err
	}
	if _, err := tx.Exec(`INSERT INTO admins_new(id, username, password_hash, role, created_at) SELECT id, username, password_hash, 'admin', created_at FROM admins`); err != nil {
		return err
	}
	if _, err := tx.Exec(`DROP TABLE admins`); err != nil {
		return err
	}
	if _, err := tx.Exec(`ALTER TABLE admins_new RENAME TO admins`); err != nil {
		return err
	}
	return tx.Commit()
}

// ensureCardColumns 为旧版 cards 表补充新列并迁移数据。
func ensureCardColumns(db *sql.DB) error {
	additions := []struct {
		column string
		ddl    string
	}{
		{"reserved_order", "ALTER TABLE cards ADD COLUMN reserved_order INTEGER NOT NULL DEFAULT 0"},
		{"sold_order", "ALTER TABLE cards ADD COLUMN sold_order INTEGER NOT NULL DEFAULT 0"},
	}
	for _, a := range additions {
		exists, err := columnExists(db, "cards", a.column)
		if err != nil {
			return err
		}
		if !exists {
			if _, err := db.Exec(a.ddl); err != nil {
				return err
			}
		}
	}
	// 旧表有 order_id 列时迁移数据并移除
	if has, _ := columnExists(db, "cards", "order_id"); has {
		if _, err := db.Exec(`UPDATE cards SET sold_order = order_id WHERE status = 'sold' AND order_id != 0`); err != nil {
			return err
		}
		if _, err := db.Exec(`UPDATE cards SET reserved_order = order_id WHERE status IN ('reserved','locked') AND order_id != 0`); err != nil {
			return err
		}
		// 删除引用 order_id 的旧索引后再删列
		if _, err := db.Exec(`DROP INDEX IF EXISTS idx_cards_order`); err != nil {
			return err
		}
		if _, err := db.Exec(`ALTER TABLE cards DROP COLUMN order_id`); err != nil {
			return err
		}
	}
	// 状态值映射：reserved -> locked
	if _, err := db.Exec(`UPDATE cards SET status = 'locked' WHERE status = 'reserved'`); err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_cards_reserved_order ON cards(reserved_order)`); err != nil {
		return err
	}
	if _, err := db.Exec(`CREATE INDEX IF NOT EXISTS idx_cards_sold_order ON cards(sold_order)`); err != nil {
		return err
	}
	return nil
}

// backfillOrderStatuses 将存量订单的旧状态值映射到新状态机值。
func backfillOrderStatuses(db *sql.DB) error {
	migrations := []struct{ from, to string }{
		{"pending", models.OrderWaitingPayment},
		{"failed", models.OrderPaymentFailed},
	}
	for _, m := range migrations {
		if _, err := db.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE status = ?`, m.to, models.Now(), m.from); err != nil {
			return err
		}
	}
	return nil
}

func columnExists(db *sql.DB, table, column string) (bool, error) {
	rows, err := db.Query(fmt.Sprintf("PRAGMA table_info(%s)", table))
	if err != nil {
		return false, err
	}
	defer rows.Close()
	for rows.Next() {
		var cid int
		var name, ctype string
		var notnull, pk int
		var dflt sql.NullString
		if err := rows.Scan(&cid, &name, &ctype, &notnull, &dflt, &pk); err != nil {
			return false, err
		}
		if name == column {
			return true, nil
		}
	}
	return false, rows.Err()
}

func ensureProductColumns(db *sql.DB) error {
	additions := []struct {
		column string
		ddl    string
	}{
		{"category", "ALTER TABLE products ADD COLUMN category TEXT NOT NULL DEFAULT ''"},
		{"sort_order", "ALTER TABLE products ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"},
		{"is_pinned", "ALTER TABLE products ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0"},
		{"image_url", "ALTER TABLE products ADD COLUMN image_url TEXT NOT NULL DEFAULT ''"},
		{"faq", "ALTER TABLE products ADD COLUMN faq TEXT NOT NULL DEFAULT ''"},
	}
	for _, a := range additions {
		exists, err := columnExists(db, "products", a.column)
		if err != nil {
			return err
		}
		if exists {
			continue
		}
		if _, err := db.Exec(a.ddl); err != nil {
			return err
		}
	}
	return nil
}

func ResetAllTables(db *sql.DB) error {
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	tables := []string{"order_logs", "cards", "orders", "products", "settings", "admins"}
	for _, t := range tables {
		if _, err := tx.Exec(fmt.Sprintf("DELETE FROM %s", t)); err != nil {
			return err
		}
	}
	if _, err := tx.Exec(`DELETE FROM sqlite_sequence WHERE name IN ('products','cards','orders')`); err != nil {
		return err
	}
	return tx.Commit()
}

func AllSettings(db *sql.DB) (map[string]string, error) {
	rows, err := db.Query(`SELECT key, value FROM settings ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

func HasAdmin(db *sql.DB) bool {
	var count int
	if err := db.QueryRow(`SELECT COUNT(1) FROM admins`).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

func SeedAdmin(db *sql.DB, username, password string) error {
	if HasAdmin(db) {
		return nil
	}
	_, err := db.Exec(`INSERT INTO admins(id, username, password_hash, role, created_at) VALUES(1, ?, ?, 'admin', ?)`, username, models.HashPassword(password), models.Now())
	return err
}

func GetSetting(db *sql.DB, key string) (string, error) {
	var value string
	err := db.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

func SetSetting(db *sql.DB, key, value string) error {
	_, err := db.Exec(`INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, value, models.Now())
	return err
}

// AddOrderLog 追加一条订单事件日志。
func AddOrderLog(db *sql.DB, orderID int64, event, message, fromStatus, toStatus string, adminID int64, metadata string) error {
	_, err := db.Exec(`INSERT INTO order_logs(order_id, event, message, from_status, to_status, admin_id, metadata, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, orderID, event, message, fromStatus, toStatus, adminID, metadata, models.Now())
	return err
}

// AddAuditLog 追加一条管理员审计日志。
func AddAuditLog(db *sql.DB, adminID int64, username, action, targetType, targetID, before, after string) error {
	_, err := db.Exec(`INSERT INTO audit_logs(admin_id, username, action, target_type, target_id, before_value, after_value, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, adminID, username, action, targetType, targetID, before, after, models.Now())
	return err
}

// AuditLogs 返回审计日志（最新在前）。
func AuditLogs(db *sql.DB, limit int) ([]models.AuditLog, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := db.Query(`SELECT id, admin_id, username, action, target_type, target_id, before_value, after_value, created_at FROM audit_logs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.AuditLog{}
	for rows.Next() {
		var l models.AuditLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.Username, &l.Action, &l.TargetType, &l.TargetID, &l.Before, &l.After, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// OrderLogs 返回某订单的事件日志（按时间正序）。
func OrderLogs(db *sql.DB, orderID int64) ([]models.OrderEvent, error) {
	rows, err := db.Query(`SELECT id, order_id, event, message, from_status, to_status, admin_id, metadata, created_at FROM order_logs WHERE order_id = ? ORDER BY id ASC`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.OrderEvent{}
	for rows.Next() {
		var e models.OrderEvent
		if err := rows.Scan(&e.ID, &e.OrderID, &e.Event, &e.Message, &e.From, &e.To, &e.AdminID, &e.Metadata, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}
