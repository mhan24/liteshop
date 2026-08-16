package sqlite

import (
	"testing"

	db "shop/internal/platform/database/sqlite"
	"shop/internal/shared/clock"
)

// TestAuditLogsAddListCleanup 审计日志写入、按最新在前读取、按保留期清理。
func TestAuditLogsAddListCleanup(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/audit.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	repo := NewAuditRepository(d)

	if err := repo.AddAuditLog(1, "admin", "product.update", "product", "5", "旧值", "新值"); err != nil {
		t.Fatalf("add log 1: %v", err)
	}
	if err := repo.AddAuditLog(2, "operator", "order.deliver", "order", "9", "", "已发货"); err != nil {
		t.Fatalf("add log 2: %v", err)
	}

	logs, err := repo.AuditLogs(10)
	if err != nil {
		t.Fatalf("list logs: %v", err)
	}
	if len(logs) != 2 {
		t.Fatalf("logs = %d, want 2", len(logs))
	}
	// 最新在前
	if logs[0].Action != "order.deliver" || logs[1].Action != "product.update" {
		t.Fatalf("ordering wrong: %+v", logs)
	}
	if logs[1].AdminID != 1 || logs[1].Username != "admin" || logs[1].TargetID != "5" || logs[1].Before != "旧值" || logs[1].After != "新值" {
		t.Fatalf("log fields wrong: %+v", logs[1])
	}
	// 清理：cutoff 早于全部日志时不删；cutoff 晚于全部日志时全删
	now := clock.Now()
	if err := repo.DeleteOldAuditLogs(now - 1); err != nil {
		t.Fatalf("cleanup none: %v", err)
	}
	remaining, _ := repo.AuditLogs(10)
	if len(remaining) != 2 {
		t.Fatalf("after early cutoff remaining = %d, want 2", len(remaining))
	}
	if err := repo.DeleteOldAuditLogs(now + 1); err != nil {
		t.Fatalf("cleanup all: %v", err)
	}
	remaining, _ = repo.AuditLogs(10)
	if len(remaining) != 0 {
		t.Fatalf("after late cutoff remaining = %d, want 0", len(remaining))
	}
}
