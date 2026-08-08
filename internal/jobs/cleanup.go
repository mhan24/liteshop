package jobs

import (
	"database/sql"
	"log"
	"time"

	"shop/internal/db"
)

// CleanupJob 周期清理：过期会话、180 天前日志，以及调用方提供的内存态清理回调
// （限流器 / 2FA 令牌 / 邮件冷却等）。
func CleanupJob(d *sql.DB, memoryCleanups ...func()) func() {
	return func() {
		now := time.Now()
		if err := db.DeleteExpiredSessions(d, now.Unix()); err != nil {
			log.Printf("job cleanup sessions: %v", err)
		}
		retention := now.Add(-180 * 24 * time.Hour).Unix()
		if err := db.DeleteOldAuditLogs(d, retention); err != nil {
			log.Printf("job cleanup audit_logs: %v", err)
		}
		if err := db.DeleteOldOrderLogs(d, retention); err != nil {
			log.Printf("job cleanup order_logs: %v", err)
		}
		for _, fn := range memoryCleanups {
			if fn != nil {
				fn()
			}
		}
	}
}
