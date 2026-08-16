package db

import (
	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	"testing"
)

func TestSettingsVersionRecorded(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	// Open 已执行 MigrateSettings：基线版本 v1 已记录。
	if v := settingssqlite.SettingsVersion(d); v != 1 {
		t.Fatalf("settings version = %d, want 1 (baseline)", v)
	}
	// 重复执行幂等：不重复记录、版本不变。
	if err := MigrateSettings(d); err != nil {
		t.Fatalf("re-run migrate settings: %v", err)
	}
	if v := settingssqlite.SettingsVersion(d); v != 1 {
		t.Fatalf("after re-run version = %d, want 1 (idempotent)", v)
	}
}
