package db

import (
	"database/sql"
	"fmt"

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
			id INTEGER PRIMARY KEY CHECK (id = 1),
			username TEXT NOT NULL,
			password_hash TEXT NOT NULL,
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
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL
		);`,
		`CREATE TABLE IF NOT EXISTS cards (
			id INTEGER PRIMARY KEY AUTOINCREMENT,
			product_id INTEGER NOT NULL REFERENCES products(id),
			order_id INTEGER NOT NULL DEFAULT 0,
			content TEXT NOT NULL,
			status TEXT NOT NULL DEFAULT 'available',
			created_at INTEGER NOT NULL,
			updated_at INTEGER NOT NULL,
			sold_at INTEGER NOT NULL DEFAULT 0
		);`,
		`CREATE INDEX IF NOT EXISTS idx_cards_product_status ON cards(product_id, status);`,
		`CREATE INDEX IF NOT EXISTS idx_cards_order ON cards(order_id);`,
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
	tables := []string{"cards", "orders", "products", "settings", "admins"}
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
	if err := db.QueryRow(`SELECT COUNT(1) FROM admins WHERE id = 1`).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

func SeedAdmin(db *sql.DB, username, password string) error {
	if HasAdmin(db) {
		return nil
	}
	_, err := db.Exec(`INSERT INTO admins(id, username, password_hash, created_at) VALUES(1, ?, ?, ?)`, username, models.HashPassword(password), models.Now())
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
