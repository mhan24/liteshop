package service

import (
	"shop/internal/models"
)

// ---- 审计 ----

func (s *AdminService) Audit(adminID int64, username, action, targetType, targetID, before, after string) error {
	return s.store.AddAuditLog(adminID, username, action, targetType, targetID, before, after)
}

func (s *AdminService) AuditLogs(limit int) ([]models.AuditLog, error) {
	return s.store.AuditLogs(limit)
}
