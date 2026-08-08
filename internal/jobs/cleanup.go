package jobs

import (
	"database/sql"
	"time"

	"shop/internal/db/repository"

	"shop/internal/logging"
)

// CleanupJob 周期清理：过期会话、180 天前日志，以及调用方提供的内存态清理回调
// （限流器 / 2FA 令牌 / 邮件冷却等）。
func CleanupJob(d *sql.DB, memoryCleanups ...func()) func() {
	return func() {
		now := time.Now()
		if err := repository.DeleteExpiredSessions(d, now.Unix()); err != nil {
			logging.App().Sugar().Errorf("job cleanup sessions: %v", err)
		}
		retention := now.Add(-180 * 24 * time.Hour).Unix()
		if err := repository.DeleteOldAuditLogs(d, retention); err != nil {
			logging.App().Sugar().Errorf("job cleanup audit_logs: %v", err)
		}
		if err := repository.DeleteOldOrderLogs(d, retention); err != nil {
			logging.App().Sugar().Errorf("job cleanup order_logs: %v", err)
		}
		for _, fn := range memoryCleanups {
			if fn != nil {
				fn()
			}
		}
	}
}
