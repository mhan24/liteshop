package http

import (
	"net/http"
	"time"

	adminapp "shop/internal/modules/admin/application"
	auditapp "shop/internal/modules/audit/application"
	settingsapp "shop/internal/modules/settings/application"
	"shop/internal/shared/value"
)

// Deps 管理员模块 HTTP 处理器依赖。
type Deps struct {
	Admin            *adminapp.AdminService
	AuditService     *auditapp.AuditService
	Stats            *adminapp.StatsService
	Jobs             *adminapp.JobsService
	Settings         *settingsapp.SettingsService
	Audit            func(r *http.Request, action, targetType, targetID, before, after string)
	ClientIP         func(r *http.Request) string
	SessionID        func(r *http.Request) (string, bool)
	CurrentSession   func(r *http.Request) (int64, string, bool)
	CurrentAdminID   func(r *http.Request) int64
	CurrentAdminName func(r *http.Request) string
	StartSession     func(w http.ResponseWriter, r *http.Request, adminID int64) error
	DBPath           string
	StartTime        time.Time
}

type Registrar interface {
	Public(method, path string, limit int, h http.HandlerFunc)
	Admin(method, path string, minRole string, h http.HandlerFunc)
}

type Handlers struct{ deps Deps }

func NewHandlers(deps Deps) *Handlers { return &Handlers{deps: deps} }

var (
	str           = value.Str
	errString     = value.ErrString
	firstNonEmpty = value.FirstNonEmpty
)

func Register(reg Registrar, h *Handlers) {
	reg.Public("GET", "/api/v1/admin/session", 0, h.AdminSession)
	reg.Public("POST", "/api/v1/admin/login", 10, h.AdminLogin)
	reg.Public("POST", "/api/v1/admin/login/verify", 10, h.AdminLoginVerify)
	reg.Public("POST", "/api/v1/admin/logout", 0, h.AdminLogout)
	reg.Admin("GET", "/api/v1/admin/dashboard", "viewer", h.Dashboard)
	reg.Admin("GET", "/api/v1/admin/sales-report", "viewer", h.AdminSalesReport)
	reg.Admin("GET", "/api/v1/admin/account", "viewer", h.AdminAccount)
	reg.Admin("POST", "/api/v1/admin/account", "operator", h.AdminAccountSave)
	reg.Admin("GET", "/api/v1/admin/totp", "viewer", h.AdminTotpStatus)
	reg.Admin("POST", "/api/v1/admin/totp/generate", "viewer", h.AdminTotpGenerate)
	reg.Admin("POST", "/api/v1/admin/totp/enable", "viewer", h.AdminTotpEnable)
	reg.Admin("POST", "/api/v1/admin/totp/disable", "viewer", h.AdminTotpDisable)
	reg.Admin("GET", "/api/v1/admin/admins", "admin", h.AdminListAdmins)
	reg.Admin("POST", "/api/v1/admin/admins", "admin", h.AdminCreateAdmin)
	reg.Admin("POST", "/api/v1/admin/admins/{id}/role", "admin", h.AdminSetRole)
	reg.Admin("POST", "/api/v1/admin/admins/{id}/delete", "admin", h.AdminDeleteAdmin)
	reg.Admin("GET", "/api/v1/admin/jobs", "viewer", h.AdminJobs)
}
