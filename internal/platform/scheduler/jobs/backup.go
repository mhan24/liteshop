package jobs

import (
	"context"

	"shop/internal/platform/backup"
)

// BackupJob 触发器：到点调用备份用例（快照/校验/保留策略在 backup.Service）。
type BackupJob struct {
	Service *backup.Service
}

func (j *BackupJob) Run(ctx context.Context) error {
	return j.Service.Run()
}
