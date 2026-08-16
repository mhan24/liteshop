package http

import (
	"net/http"

	adminapp "shop/internal/modules/admin/application"
	settingsapp "shop/internal/modules/settings/application"
	"shop/internal/shared/value"
)

// Deps 站点/支付/通知配置模块 HTTP 处理器依赖。
type Deps struct {
	Settings *settingsapp.SettingsService
	Admin    *adminapp.AdminService
	Notify   *settingsapp.NotifyService
	Audit    func(r *http.Request, action, targetType, targetID, before, after string)
	// ResetLimiters 清空限流器（配置恢复后由组合根提供）。
	ResetLimiters func()
}

type Registrar interface {
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
	reg.Admin("GET", "/api/v1/admin/settings", "viewer", h.AdminSettings)
	reg.Admin("POST", "/api/v1/admin/settings", "admin", h.AdminSettingsSave)
	reg.Admin("GET", "/api/v1/admin/notify", "operator", h.AdminNotify)
	reg.Admin("POST", "/api/v1/admin/notify", "admin", h.AdminNotifySave)
	reg.Admin("POST", "/api/v1/admin/notify/test-email", "operator", h.AdminNotifyTestEmail)
	reg.Admin("POST", "/api/v1/admin/notify/test-telegram", "operator", h.AdminNotifyTestTelegram)
	reg.Admin("POST", "/api/v1/admin/notify/test-event", "operator", h.AdminNotifyTestEvent)
	reg.Admin("GET", "/api/v1/admin/site", "viewer", h.AdminSite)
	reg.Admin("POST", "/api/v1/admin/site", "admin", h.AdminSiteSave)
	reg.Admin("GET", "/api/v1/admin/system/backup", "admin", h.AdminSystemBackup)
	reg.Admin("POST", "/api/v1/admin/system/restore", "admin", h.AdminSystemRestore)
	reg.Admin("POST", "/api/v1/admin/system/reset", "admin", h.AdminSystemReset)
	reg.Admin("GET", "/api/v1/admin/version", "viewer", h.AdminVersion)
}
