package service

import "shop/internal/models"

// JobsService 后台任务状态查询（供后台展示：最后执行结果 / 邮件队列积压）。
type JobsService struct {
	store JobsStore
}

func NewJobsService(store JobsStore) *JobsService {
	return &JobsService{store: store}
}

// Runs 返回每个任务的最新执行记录与待发送邮件数。
func (s *JobsService) Runs() ([]models.JobRun, int, error) {
	runs, err := s.store.LatestJobRuns()
	if err != nil {
		return nil, 0, err
	}
	pending, err := s.store.PendingMailCount()
	if err != nil {
		return nil, 0, err
	}
	return runs, pending, nil
}
