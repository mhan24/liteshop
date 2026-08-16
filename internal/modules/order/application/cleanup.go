package application

// CleanupOldLogs 清理超过保留期的订单事件日志（由清理任务经应用用例调用）。
func (s *OrderService) CleanupOldLogs(cutoff int64) error {
	return s.repo.DeleteOldLogs(cutoff)
}
