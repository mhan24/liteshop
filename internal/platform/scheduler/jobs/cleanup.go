package jobs

import "context"

// CleanupJob 触发器：清理用例由组合根组装（各模块应用用例 + 平台基础设施清理），
// job 本身只负责到点触发并透传错误。
type CleanupJob struct {
	RunFunc func(ctx context.Context) error
}

func (j *CleanupJob) Run(ctx context.Context) error {
	if j.RunFunc == nil {
		return nil
	}
	return j.RunFunc(ctx)
}
