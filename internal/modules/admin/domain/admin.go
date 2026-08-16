// Package domain 管理员/角色领域模型。
package domain

import "errors"

// 管理员角色。
const (
	RoleAdmin    = "admin"
	RoleOperator = "operator"
	RoleViewer   = "viewer"
)

// AdminRow 管理员列表行。
type AdminRow struct {
	ID        int64
	Username  string
	Role      string
	CreatedAt int64
}

// JobRun 后台任务一次执行记录。
type JobRun struct {
	ID         int64
	JobName    string
	StartedAt  int64
	FinishedAt int64
	Status     string
	Error      string
}

// 任务执行状态。
const (
	JobRunRunning = "running"
	JobRunOK      = "ok"
	JobRunError   = "error"
)

var (
	ErrAdminNotFound      = errors.New("admin not found")
	ErrLastAdmin          = errors.New("cannot demote the last admin")
	ErrAdminExists        = errors.New("admin already exists")
	ErrUsernameTaken      = errors.New("username already taken")
	ErrTotpUpgradeFailed  = errors.New("totp secret upgrade failed")
	ErrTotpAlreadyEnabled = errors.New("totp already enabled")
)
