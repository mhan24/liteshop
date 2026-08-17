package db

import (
	"database/sql"
	"fmt"

	"shop/internal/shared/clock"
)

// settingsMigration 一个配置升级步骤。
type settingsMigration struct {
	Version int
	Apply   func(d *sql.DB) error
}

// settingsMigrations 配置升级步骤（按版本号顺序执行一次并记录到 settings_version）。
// 新增配置升级：在末尾追加 {Version: N, Apply: ...}，禁止修改历史步骤。
var settingsMigrations = []settingsMigration{
	// v1：基线配置结构（settings + secrets 当前形态）。
	{Version: 1, Apply: nil},
}

// MigrateSettings 应用未执行的配置升级（幂等：已记录的版本跳过）。
// 在 schema.Migrate 之后调用；settings_version 表由迁移 020 创建。
func MigrateSettings(d *sql.DB) error {
	for _, m := range settingsMigrations {
		var n int
		if err := d.QueryRow(`SELECT COUNT(1) FROM settings_version WHERE version = ?`, m.Version).Scan(&n); err != nil {
			return err
		}
		if n > 0 {
			continue
		}
		if m.Apply != nil {
			if err := m.Apply(d); err != nil {
				return fmt.Errorf("settings migration %d: %w", m.Version, err)
			}
		}
		if _, err := d.Exec(`INSERT INTO settings_version(version, applied_at) VALUES(?, ?)`, m.Version, clock.Now()); err != nil {
			return err
		}
	}
	return nil
}
