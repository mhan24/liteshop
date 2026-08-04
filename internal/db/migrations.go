package db

import (
	"database/sql"
	"embed"
	"fmt"
	"io/fs"
	"sort"
	"strings"

	"shop/internal/models"
)

//go:embed migrations/*.sql
var migrationFS embed.FS

// legacyUpgrades 为需要 Go 条件判断的存量库升级（SQLite 不支持 ADD COLUMN IF NOT EXISTS）。
// key 为迁移文件 basename（含 .sql 后缀），与 listMigrationFiles 的 basename 匹配。
var legacyUpgrades = map[string]func(*sql.DB) error{
	"002_legacy_upgrade.sql":  legacyUpgrade,
	"004_product_columns.sql": ensureProductColumns,
}

// migrateDB 执行所有未应用的数据库迁移。
func migrateDB(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`); err != nil {
		return err
	}

	names := listMigrationFiles()
	for _, name := range names {
		applied, err := migrationApplied(db, name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		// 若是纯 SQL 文件则执行
		if strings.HasSuffix(name, ".sql") && !isGoOnlyMigration(name) {
			if err := runSQLMigration(db, name); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
		}
		// 执行 Go 升级逻辑（如有），按 basename 匹配
		base := name
		if i := strings.LastIndex(base, "/"); i >= 0 {
			base = base[i+1:]
		}
		if fn, ok := legacyUpgrades[base]; ok {
			if err := fn(db); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
		}
		if _, err := db.Exec(`INSERT INTO schema_migrations(version, applied_at) VALUES(?, ?)`, name, models.Now()); err != nil {
			return err
		}
	}
	return nil
}

func listMigrationFiles() []string {
	entries, err := fs.ReadDir(migrationFS, "migrations")
	if err != nil {
		return nil
	}
	out := []string{}
	for _, e := range entries {
		if !e.IsDir() {
			out = append(out, "migrations/"+e.Name())
		}
	}
	sort.Strings(out)
	return out
}

func migrationApplied(db *sql.DB, name string) (bool, error) {
	var n int
	err := db.QueryRow(`SELECT COUNT(1) FROM schema_migrations WHERE version = ?`, name).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// isGoOnlyMigration 标记仅含 Go 逻辑、无独立 SQL 的迁移文件。
func isGoOnlyMigration(name string) bool {
	return strings.Contains(name, "legacy_upgrade") || strings.Contains(name, "004_product_columns")
}

func runSQLMigration(db *sql.DB, name string) error {
	data, err := migrationFS.ReadFile(name)
	if err != nil {
		return err
	}
	stmts := splitSQL(string(data))
	tx, err := db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	for _, stmt := range stmts {
		if strings.TrimSpace(stmt) == "" {
			continue
		}
		if _, err := tx.Exec(stmt); err != nil {
			return fmt.Errorf("%s: %s: %w", name, truncate(stmt, 80), err)
		}
	}
	return tx.Commit()
}

// splitSQL 按分号拆分 SQL 语句（忽略注释与引号内的分号，简化为按行简单拆分）。
func splitSQL(s string) []string {
	var out []string
	var cur strings.Builder
	inQuote := rune(0)
	for _, r := range s {
		if inQuote != 0 {
			cur.WriteRune(r)
			if r == inQuote {
				inQuote = 0
			}
			continue
		}
		switch r {
		case '\'', '"', '`':
			inQuote = r
			cur.WriteRune(r)
		case ';':
			out = append(out, cur.String())
			cur.Reset()
		case '\n':
			// 忽略单行注释
			line := strings.TrimSpace(cur.String())
			if strings.HasPrefix(line, "--") {
				cur.Reset()
				continue
			}
			cur.WriteRune(r)
		default:
			cur.WriteRune(r)
		}
	}
	if strings.TrimSpace(cur.String()) != "" {
		out = append(out, cur.String())
	}
	return out
}

func truncate(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return s[:n] + "..."
}

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
