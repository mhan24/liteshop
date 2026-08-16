package application

import "shop/internal/modules/audit/domain"

// AuditStore 审计日志数据访问端口。
type AuditStore interface {
	AddAuditLog(adminID int64, username, action, targetType, targetID, before, after string) error
	AuditLogs(limit int) ([]domain.AuditLog, error)
	DeleteOldAuditLogs(cutoff int64) error
}
