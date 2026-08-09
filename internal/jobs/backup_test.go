package jobs

import (
	"os"
	"path/filepath"
	"testing"

	"shop/internal/db"
)

func TestVerifyBackupOK(t *testing.T) {
	path := filepath.Join(t.TempDir(), "backup.db")
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()
	if err := verifyBackup(path); err != nil {
		t.Fatalf("valid backup should pass verify: %v", err)
	}
}

func TestVerifyBackupRejectsGarbage(t *testing.T) {
	path := filepath.Join(t.TempDir(), "bad.db")
	if err := os.WriteFile(path, []byte("this is not a sqlite database"), 0o600); err != nil {
		t.Fatalf("write: %v", err)
	}
	if err := verifyBackup(path); err == nil {
		t.Fatal("garbage file must fail integrity check")
	}
}

func TestVerifyBackupRejectsTruncated(t *testing.T) {
	src := filepath.Join(t.TempDir(), "src.db")
	d, err := db.Open(src)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()
	raw, err := os.ReadFile(src)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	// 截断一半模拟损坏/不完整备份
	bad := filepath.Join(t.TempDir(), "truncated.db")
	if err := os.WriteFile(bad, raw[:len(raw)/2], 0o600); err != nil {
		t.Fatalf("write truncated: %v", err)
	}
	if err := verifyBackup(bad); err == nil {
		t.Fatal("truncated file must fail integrity check")
	}
}

func TestBackupJobProducesVerifiedBackup(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/shop.db"
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()
	run := BackupJob(path, 1)
	run()
	entries, err := os.ReadDir(dir + "/backups")
	if err != nil {
		t.Fatalf("backups dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("backups = %d, want 1", len(entries))
	}
	target := filepath.Join(dir+"/backups", entries[0].Name())
	if err := verifyBackup(target); err != nil {
		t.Fatalf("produced backup failed verify: %v", err)
	}
}
