package application

import (
	"shop/internal/modules/admin/domain"
)

// AdminStore 管理员/会话数据访问端口。
type AdminStore interface {
	HasAdmin() bool
	SeedAdmin(username, password string) (bool, error)
	AdminByUsername(username string) (adminID int64, hash, totpSecret string, totpEnabled bool, err error)
	AdminRole(id int64) (string, error)
	AdminUsername(id int64) (string, error)
	AdminPasswordHash(id int64) (string, error)
	UpdateAdminAccount(id int64, username, hash string) error
	AdminTOTP(id int64) (enabled bool, secret string, err error)
	SetAdminTOTPSecret(id int64, secret string) error
	SetAdminTOTPEnabled(id int64, enabled bool) error
	ListAdmins() ([]domain.AdminRow, error)
	AdminCountByRole(role string) (int, error)
	CreateAdmin(username, passwordHash, role string) error
	SetAdminRoleGuarded(id int64, role string) error
	DeleteAdmin(id int64) error
	CreateSession(id string, adminID int64, expiresAt int64) error
	SessionAdminID(id string) (adminID, expiresAt int64, err error)
	SlideSessionExpiry(id string, expiresAt int64) error
	DeleteSession(id string) error
	DeleteSessionsByAdmin(adminID int64) error
	DeleteAllSessions() error
	DeleteExpiredSessions(now int64) error
	DeleteOldJobRuns(cutoff int64) error
}

// JobsStore 后台任务执行记录数据访问端口。
type JobsStore interface {
	LatestJobRuns() ([]domain.JobRun, error)
	PendingMailCount() (int, error)
	DeadEventCount() (int, error)
}

// StatsStore 健康/统计所需的数据访问端口。
type StatsStore interface {
	SchemaVersion() int
	IntegrityOK() bool
	PendingMailCount() (int, error)
	LatestJobRuns() ([]domain.JobRun, error)
}
