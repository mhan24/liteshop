package http

import (
	"net/http"

	auditapp "shop/internal/modules/audit/application"
)

// Deps 审计模块 HTTP 处理器依赖。
type Deps struct {
	AuditService *auditapp.AuditService
}

type Registrar interface {
	Admin(method, path string, minRole string, h http.HandlerFunc)
}

type Handlers struct{ deps Deps }

func NewHandlers(deps Deps) *Handlers { return &Handlers{deps: deps} }

func Register(reg Registrar, h *Handlers) {
	reg.Admin("GET", "/api/v1/admin/audit-logs", "admin", h.AdminAuditLogs)
}
