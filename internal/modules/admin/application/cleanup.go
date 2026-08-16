package application

// CleanupExpiredSessions 清理过期会话（经应用用例调用，不直接写 SQL）。
func (s *AdminService) CleanupExpiredSessions(now int64) error {
	return s.store.DeleteExpiredSessions(now)
}

// CleanupOldJobRuns 清理超过保留期的任务执行记录。
func (s *AdminService) CleanupOldJobRuns(cutoff int64) error {
	return s.store.DeleteOldJobRuns(cutoff)
}
