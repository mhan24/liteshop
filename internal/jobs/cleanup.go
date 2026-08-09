package jobs

import (
	"database/sql"
	"time"

	"shop/internal/db/repository"

	"shop/internal/logging"
)

// CleanupJob 周期清理：过期会话、180 天前日志，以及调用方提供的内存态清理回调
// （限流器 / 2FA 令牌 / 邮件冷却等）。
func CleanupJob(d *sql.DB, memoryCleanups ...func()) func() error {
	return func() error {
		now := time.Now()
		if err := repository.DeleteExpiredSessions(d, now.Unix()); err != nil {
			logging.App().Sugar().Errorf("job cleanup sessions: %v", err)
			return err
		}
		retention := now.Add(-180 * 24 * time.Hour).Unix()
		if err := repository.DeleteOldAuditLogs(d, retention); err != nil {
			logging.App().Sugar().Errorf("job cleanup audit_logs: %v", err)
			return err
		}
		if err := repository.DeleteOldOrderLogs(d, retention); err != nil {
			logging.App().Sugar().Errorf("job cleanup order_logs: %v", err)
			return err
		}
		// Outbox 生命周期：已发布事件保留 30 天，定期清理（未发布的不动）。
		if err := repository.DeleteOldOutboxEvents(d, now.Add(-30*24*time.Hour).Unix()); err != nil {
			logging.App().Sugar().Errorf("job cleanup outbox_events: %v", err)
			return err
		}
		// 邮件队列：失败超上限且超 30 天的行不再保留。
		if err := repository.DeleteStaleMailQueue(d, now.Add(-30*24*time.Hour).Unix()); err != nil {
			logging.App().Sugar().Errorf("job cleanup mail_queue: %v", err)
			return err
		}
		for _, fn := range memoryCleanups {
			if fn != nil {
				fn()
			}
		}
		return nil
	}
}
