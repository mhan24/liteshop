package application

// CleanupOld 清理超过保留期的审计日志（经应用用例调用）。
func (s *AuditService) CleanupOld(cutoff int64) error {
	return s.store.DeleteOldAuditLogs(cutoff)
}
