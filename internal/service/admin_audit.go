package service

import (
	"shop/internal/db/repository"
	"shop/internal/models"
)

// ---- 审计 ----

func (s *AdminService) Audit(adminID int64, username, action, targetType, targetID, before, after string) error {
	return repository.AddAuditLog(s.db, adminID, username, action, targetType, targetID, before, after)
}

func (s *AdminService) AuditLogs(limit int) ([]models.AuditLog, error) {
	return repository.AuditLogs(s.db, limit)
}
