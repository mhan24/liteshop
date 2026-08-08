package api

import (
	"embed"
	"io/fs"
	"net/http"
	"strings"
)

//go:embed admin-ui
var assets embed.FS

func adminAssetsFS() http.FileSystem {
	sub, err := fs.Sub(assets, "admin-ui")
	if err != nil {
		return http.FS(assets)
	}
	return http.FS(sub)
}

func (s *Server) adminIndex(w http.ResponseWriter, r *http.Request) {
	data, err := assets.ReadFile("admin-ui/index.html")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	_, _ = w.Write(data)
}

// chooseLang 返回当前语言（读取 lang Cookie，默认 zh）。
func chooseLang(r *http.Request) string {
	if c, err := r.Cookie("lang"); err == nil && strings.TrimSpace(c.Value) == "en" {
		return "en"
	}
	return "zh"
}
