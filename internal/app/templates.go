package app

import (
	"net/http"
	"strings"

	"shop/web"
)

func (s *Server) adminIndex(w http.ResponseWriter, r *http.Request) {
	data, err := web.Index()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

// adminAssetsFS 返回后台 SPA 静态资源（web/admin/dist）。
func adminAssetsFS() http.FileSystem {
	return web.FS()
}

// chooseLang 返回当前语言（读取 lang Cookie，默认 zh）。
func chooseLang(r *http.Request) string {
	if c, err := r.Cookie("lang"); err == nil && strings.TrimSpace(c.Value) == "en" {
		return "en"
	}
	return "zh"
}
