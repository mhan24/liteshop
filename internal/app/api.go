package app

import (
	"crypto/hmac"
	"net/http"

	"shop/internal/platform/httpserver"
	"strings"
)

// hmacEqual 恒定时间比较（维护模式解锁令牌等）。
func hmacEqual(a, b string) bool {
	return hmac.Equal([]byte(a), []byte(b))
}

func writeJSON(w http.ResponseWriter, status int, data any) {
	httpserver.WriteJSON(w, status, data)
}

func writeError(w http.ResponseWriter, status int, msg string) {
	httpserver.WriteError(w, status, msg)
}

func writeInternalError(w http.ResponseWriter, err error) {
	httpserver.WriteInternalError(w, err)
}

func (s *Server) registerAPI(mux *http.ServeMux) {
	// 应用级（跨模块/初始化）端点：维护解锁、初始化、站点信息、语言、静态页。
	mux.HandleFunc("POST /api/v1/maintenance/unlock", s.rateLimitMiddleware("maintenance_unlock", 10, s.apiMaintenanceUnlock))
	mux.HandleFunc("GET /api/v1/setup", s.apiSetupStatus)
	mux.HandleFunc("POST /api/v1/setup", s.rateLimitMiddleware("setup", 10, s.apiSetup))
	mux.HandleFunc("GET /api/v1/site", s.apiSite)
	mux.HandleFunc("GET /api/v1/pages/{slug}", s.apiPage)
	mux.HandleFunc("POST /api/v1/lang", s.apiSetLang)
	// 各模块业务路由由 registerModuleRoutes 注册（transport/http → application）。
}

func currencySymbol(currency string) string {
	switch strings.ToUpper(strings.TrimSpace(currency)) {
	case "USD":
		return "$"
	case "EUR":
		return "€"
	case "GBP":
		return "£"
	case "JPY":
		return "¥"
	default:
		return strings.ToUpper(strings.TrimSpace(currency))
	}
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

// DefaultProductImage 是内置默认占位图（站内资源，前端兜底 /default-product.svg）。
const DefaultProductImage = ""

func (s *Server) maintenanceUnlocked(r *http.Request, password string) bool {
	c, err := r.Cookie("maint_unlock")
	if err != nil {
		return false
	}
	return hmacEqual(c.Value, s.maintToken(s.settings.NormalizeMaintenanceHash(password)))
}
