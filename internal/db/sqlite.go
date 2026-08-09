package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"

	"shop/internal/db/schema"
)

// Open 打开 SQLite 数据库并执行迁移（当前默认实现）。
func Open(path string) (*sql.DB, error) {
	// _txlock=immediate：所有事务在 BEGIN 时立即获取写锁（SQLite 的"行锁模拟"），
	// 并发写事务串行化，先读后写也不会出现脏读/超卖竞态。
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)&_txlock=immediate", path)
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(1)
	if err := d.Ping(); err != nil {
		return nil, err
	}
	// WAL 提升并发读写；busy_timeout/foreign_keys 由 DSN 设置。
	if _, err := d.Exec(`PRAGMA journal_mode=WAL`); err != nil {
		return nil, err
	}
	if err := schema.Migrate(d); err != nil {
		return nil, err
	}
	if err := MigrateSettings(d); err != nil {
		return nil, err
	}
	return d, nil
}
