package schema

import (
	"database/sql"
	"errors"
	"fmt"
	"strings"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/security"
)

// legacyUpgrade 将旧版本库升级到最新结构（幂等）。
func legacyUpgrade(db *sql.DB) error {
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

// addColumnIfMissing 仅当列不存在时执行 ALTER，保证迁移幂等。
func addColumnIfMissing(db *sql.DB, table, column, ddl string) error {
	exists, err := columnExists(db, table, column)
	if err != nil {
		return err
	}
	if exists {
		return nil
	}
	_, err = db.Exec(ddl)
	return err
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
		totp_secret TEXT NOT NULL DEFAULT '',
		totp_enabled INTEGER NOT NULL DEFAULT 0,
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
		{"wholesale", "ALTER TABLE products ADD COLUMN wholesale TEXT NOT NULL DEFAULT ''"},
		{"min_qty", "ALTER TABLE products ADD COLUMN min_qty INTEGER NOT NULL DEFAULT 1"},
		{"max_qty", "ALTER TABLE products ADD COLUMN max_qty INTEGER NOT NULL DEFAULT 100"},
		{"cost_cents", "ALTER TABLE products ADD COLUMN cost_cents INTEGER NOT NULL DEFAULT 0"},
		{"delivery_type", "ALTER TABLE products ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'auto'"},
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

// ensureManualDeliveryColumns 为存量库补充人工手动交付相关列（幂等）。
func ensureManualDeliveryColumns(db *sql.DB) error {
	additions := []struct {
		table  string
		column string
		ddl    string
	}{
		{"products", "delivery_type", "ALTER TABLE products ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'auto'"},
		{"orders", "delivery_type", "ALTER TABLE orders ADD COLUMN delivery_type TEXT NOT NULL DEFAULT 'auto'"},
		{"orders", "delivery_content", "ALTER TABLE orders ADD COLUMN delivery_content TEXT NOT NULL DEFAULT ''"},
	}
	for _, a := range additions {
		exists, err := columnExists(db, a.table, a.column)
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

// ensureSecretsTable 建 secrets 表，并把存量 settings 中的敏感配置迁移为 AES 加密存储。
func ensureSecretsTable(db *sql.DB) error {
	cipher := security.NewCipher(repository.EnsureSessionSecret(db))
	if cipher == nil {
		return errors.New("cipher init failed")
	}
	for _, key := range repository.SecretSettingKeys {
		v, err := repository.GetSetting(db, key)
		if err != nil {
			return err
		}
		if strings.TrimSpace(v) == "" {
			continue
		}
		if cipher.IsEncrypted(v) {
			if err := repository.UpsertSecretRaw(db, key, v); err != nil {
				return err
			}
		} else {
			enc, err := cipher.Encrypt(v)
			if err != nil {
				return err
			}
			if err := repository.UpsertSecretRaw(db, key, enc); err != nil {
				return err
			}
		}
		if _, err := db.Exec(`DELETE FROM settings WHERE key = ?`, key); err != nil {
			return err
		}
	}
	return nil
}
