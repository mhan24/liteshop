package db

import (
	"database/sql"
	"fmt"

	_ "modernc.org/sqlite"
)

// Open 打开 SQLite 数据库并执行迁移（当前默认实现）。
func Open(path string) (*sql.DB, error) {
	dsn := fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)&_pragma=foreign_keys(1)", path)
	d, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	d.SetMaxOpenConns(1)
	if err := d.Ping(); err != nil {
		return nil, err
	}
	if err := migrate(d); err != nil {
		return nil, err
	}
	return d, nil
}
