// Package domain 审计日志领域模型。
package domain

// AuditLog 管理员审计日志。
type AuditLog struct {
	ID         int64
	AdminID    int64
	Username   string
	Action     string
	TargetType string
	TargetID   string
	Before     string
	After      string
	CreatedAt  int64
}
