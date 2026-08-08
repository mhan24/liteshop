package db

import (
	"database/sql"
	"errors"
)

// OpenPostgres 打开 PostgreSQL 数据库（未来备用）。
// 当前仅提供占位实现：仓库层与 database/sql 已驱动无关，接入 PG 时
// 只需在此提供驱动与 DSN，并补充 PG 方言的迁移文件。
func OpenPostgres(dsn string) (*sql.DB, error) {
	_ = dsn
	return nil, errors.New("postgres support is not implemented yet")
}
