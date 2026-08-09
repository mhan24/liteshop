package jobs

import (
	"database/sql"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	_ "modernc.org/sqlite"
	"shop/internal/logging"
)

// BackupJob 定期备份 SQLite 数据库（VACUUM INTO 一致性快照），保留最近 keep 份。
func BackupJob(databasePath string, keep int) func() error {
	return func() error {
		dir := filepath.Join(filepath.Dir(databasePath), "backups")
		if err := os.MkdirAll(dir, 0o700); err != nil {
			logging.App().Sugar().Errorf("job backup mkdir: %v", err)
			return err
		}
		name := fmt.Sprintf("shop-%s.db", time.Now().Format("20060102-150405"))
		target := filepath.Join(dir, name)
		// 备份连接只用于 VACUUM INTO，不跑迁移（迁移只由主库连接执行）。
		d, err := sql.Open("sqlite", fmt.Sprintf("file:%s?_pragma=busy_timeout(5000)", databasePath))
		if err != nil {
			logging.App().Sugar().Errorf("job backup open: %v", err)
			return err
		}
		_, err = d.Exec(fmt.Sprintf("VACUUM INTO '%s'", strings.ReplaceAll(target, "'", "''")))
		d.Close()
		if err != nil {
			logging.App().Sugar().Errorf("job backup vacuum: %v", err)
			return err
		}
		// 备份校验：只读打开 + PRAGMA integrity_check，防止坏备份文件混入保留列表。
		if err := verifyBackup(target); err != nil {
			_ = os.Remove(target)
			logging.App().Sugar().Errorf("job backup verify failed, removed: %s: %v", target, err)
			return err
		}
		_ = os.Chmod(target, 0o600)
		pruneOldBackups(dir, keep)
		logging.App().Sugar().Infof("job backup: %s (verified)", target)
		return nil
	}
}

// verifyBackup 以只读方式打开备份文件并执行 PRAGMA integrity_check，
// 返回 nil 表示备份完整可用。
func verifyBackup(path string) error {
	d, err := sql.Open("sqlite", "file:"+path+"?mode=ro&_pragma=busy_timeout(3000)")
	if err != nil {
		return err
	}
	defer d.Close()
	var result string
	if err := d.QueryRow(`PRAGMA integrity_check`).Scan(&result); err != nil {
		return err
	}
	if result != "ok" {
		return fmt.Errorf("integrity_check: %s", result)
	}
	return nil
}

func pruneOldBackups(dir string, keep int) {
	if keep <= 0 {
		keep = 7
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return
	}
	var files []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasPrefix(e.Name(), "shop-") && strings.HasSuffix(e.Name(), ".db") {
			files = append(files, e.Name())
		}
	}
	sort.Strings(files)
	for i := 0; i < len(files)-keep; i++ {
		_ = os.Remove(filepath.Join(dir, files[i]))
	}
}
