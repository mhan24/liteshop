package application

import "shop/internal/modules/audit/domain"

// AuditService 审计日志业务逻辑。
type AuditService struct {
	store AuditStore
}

func NewAuditService(store AuditStore) *AuditService {
	return &AuditService{store: store}
}

func (s *AuditService) Audit(adminID int64, username, action, targetType, targetID, before, after string) error {
	return s.store.AddAuditLog(adminID, username, action, targetType, targetID, before, after)
}

func (s *AuditService) AuditLogs(limit int) ([]domain.AuditLog, error) {
	return s.store.AuditLogs(limit)
}
