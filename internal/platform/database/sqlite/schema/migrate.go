// Package schema 负责数据库 schema 演进：迁移执行器与存量库升级。
//
// 设计约定（Laravel/Django 风格）：
//   - 所有 schema 变更必须新增"编号 .sql 迁移文件"（migrations/），按序执行并记录到 schema_migrations；
//   - 迁移只执行一次，禁止在启动时做"检查表/自动补列"；
//   - legacy 升级仅用于 SQLite 无法用纯 SQL 表达的存量升级（条件 ALTER / 表重建 / 数据迁移）。
package schema

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"

	"shop/internal/models"
)

// MigrationsDir 迁移 SQL 文件所在目录（相对运行目录，可被 app 覆盖为绝对路径）。
var MigrationsDir = "migrations"

// key 为迁移文件 basename（含 .sql 后缀），与 listMigrationFiles 的 basename 匹配。
var legacyUpgrades = map[string]func(*sql.DB) error{
	"002_legacy_upgrade.sql":  legacyUpgrade,
	"004_product_columns.sql": ensureProductColumns,
	"015_secrets.sql":         ensureSecretsTable,
	"026_manual_delivery.sql": ensureManualDeliveryColumns,
}

// Migrate 执行所有未应用的数据库迁移。
func Migrate(db *sql.DB) error {
	if _, err := db.Exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
		version TEXT PRIMARY KEY,
		applied_at INTEGER NOT NULL
	)`); err != nil {
		return err
	}

	root := MigrationsRoot()
	if root == "" {
		return fmt.Errorf("migration directory not found (configured path: %q)", MigrationsDir)
	}
	names, err := listMigrationFiles(root)
	if err != nil {
		return err
	}
	for _, name := range names {
		path := filepath.Join(root, name)
		applied, err := migrationApplied(db, name)
		if err != nil {
			return err
		}
		if applied {
			continue
		}
		// 若是纯 SQL 文件则执行
		if strings.HasSuffix(name, ".sql") && !isGoOnlyMigration(name) {
			if err := runSQLMigration(db, path); err != nil {
				return fmt.Errorf("migration %s: %w", name, err)
			}
		}
		// 执行 Go 升级逻辑（如有），按 basename 匹配
		if fn, ok := legacyUpgrades[name]; ok {
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

func listMigrationFiles(dir string) ([]string, error) {
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read migration directory %q: %w", dir, err)
	}
	out := []string{}
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(e.Name(), ".sql") {
			out = append(out, e.Name())
		}
	}
	sort.Strings(out)
	if len(out) == 0 {
		return nil, fmt.Errorf("migration directory %q contains no .sql files", dir)
	}
	return out, nil
}

// MigrationsRoot 返回迁移目录：优先显式配置；其次 CWD/migrations；
// 否则从 CWD 逐级向上查找包含 001_initial.sql 的 migrations 目录（兼容 go test 各包 CWD）。
func MigrationsRoot() string {
	if MigrationsDir != "" {
		if fi, err := os.Stat(MigrationsDir); err == nil && fi.IsDir() {
			return MigrationsDir
		}
	}
	dir, err := os.Getwd()
	if err != nil {
		return ""
	}
	for i := 0; i < 8; i++ {
		candidate := filepath.Join(dir, "migrations")
		if _, err := os.Stat(filepath.Join(candidate, "001_init.sql")); err == nil {
			return candidate
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func migrationApplied(db *sql.DB, name string) (bool, error) {
	var n int
	// 新版本只保存 basename。兼容旧版本曾保存的 migrations/xxx.sql、
	// Windows 分隔符以及绝对目录路径，避免部署目录变化后重复执行 ALTER。
	err := db.QueryRow(`SELECT COUNT(1) FROM schema_migrations
		WHERE version = ? OR replace(version, '\\', '/') LIKE ?`, name, "%/"+name).Scan(&n)
	if err != nil {
		return false, err
	}
	return n > 0, nil
}

// isGoOnlyMigration 标记仅含 Go 逻辑、无独立 SQL 的迁移文件。
func isGoOnlyMigration(name string) bool {
	// 注意：015_secrets.sql 含真实建表 SQL，必须走 runSQLMigration，
	// 其后 Go 步骤 ensureSecretsTable 只做存量数据加密迁移。
	return strings.Contains(name, "legacy_upgrade") || strings.Contains(name, "004_product_columns") || strings.Contains(name, "026_manual_delivery")
}

func runSQLMigration(db *sql.DB, name string) error {
	data, err := os.ReadFile(name)
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
