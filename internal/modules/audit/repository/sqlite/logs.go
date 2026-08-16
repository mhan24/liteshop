package sqlite

import (
	"database/sql"

	"shop/internal/modules/audit/domain"
	"shop/internal/shared/clock"
)

// AuditRepository 实现 audit/application.AuditStore。
type AuditRepository struct {
	db *sql.DB
}

func NewAuditRepository(db *sql.DB) *AuditRepository {
	return &AuditRepository{db: db}
}

// AddAuditLog 追加一条管理员审计日志。
func AddAuditLog(d *sql.DB, adminID int64, username, action, targetType, targetID, before, after string) error {
	_, err := d.Exec(`INSERT INTO audit_logs(admin_id, username, action, target_type, target_id, before_value, after_value, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, adminID, username, action, targetType, targetID, before, after, clock.Now())
	return err
}

// AuditLogs 返回审计日志（最新在前）。
func (r *AuditRepository) AuditLogs(limit int) ([]domain.AuditLog, error) {
	if limit <= 0 {
		limit = 200
	}
	rows, err := r.db.Query(`SELECT id, admin_id, username, action, target_type, target_id, before_value, after_value, created_at FROM audit_logs ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.AuditLog{}
	for rows.Next() {
		var l domain.AuditLog
		if err := rows.Scan(&l.ID, &l.AdminID, &l.Username, &l.Action, &l.TargetType, &l.TargetID, &l.Before, &l.After, &l.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// AuditLogs 包级函数：返回审计日志（最新在前）。
func AuditLogs(d *sql.DB, limit int) ([]domain.AuditLog, error) {
	return NewAuditRepository(d).AuditLogs(limit)
}

// DeleteOldAuditLogs 删除 created_at 早于 cutoff 的审计日志（包级函数，供清理任务使用）。
func DeleteOldAuditLogs(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM audit_logs WHERE created_at < ?`, cutoff)
	return err
}

// DeleteOldAuditLogsUntil 方法形式，满足 audit/application.AuditStore。
func (r *AuditRepository) DeleteOldAuditLogs(cutoff int64) error {
	return DeleteOldAuditLogs(r.db, cutoff)
}

// AddAuditLog 追加一条管理员审计日志。
func (r *AuditRepository) AddAuditLog(adminID int64, username, action, targetType, targetID, before, after string) error {
	_, err := r.db.Exec(`INSERT INTO audit_logs(admin_id, username, action, target_type, target_id, before_value, after_value, created_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?)`, adminID, username, action, targetType, targetID, before, after, clock.Now())
	return err
}
