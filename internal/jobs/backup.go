package jobs

import (
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"shop/internal/db"
)

// BackupJob 定期备份 SQLite 数据库（VACUUM INTO 一致性快照），保留最近 keep 份。
func BackupJob(databasePath string, keep int) func() {
	return func() {
		dir := filepath.Join(filepath.Dir(databasePath), "backups")
		if err := os.MkdirAll(dir, 0o700); err != nil {
			log.Printf("job backup mkdir: %v", err)
			return
		}
		name := fmt.Sprintf("shop-%s.db", time.Now().Format("20060102-150405"))
		target := filepath.Join(dir, name)
		d, err := db.Open(databasePath)
		if err != nil {
			log.Printf("job backup open: %v", err)
			return
		}
		_, err = d.Exec(fmt.Sprintf("VACUUM INTO '%s'", strings.ReplaceAll(target, "'", "''")))
		d.Close()
		if err != nil {
			log.Printf("job backup vacuum: %v", err)
			return
		}
		_ = os.Chmod(target, 0o600)
		pruneOldBackups(dir, keep)
		log.Printf("job backup: %s", target)
	}
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
