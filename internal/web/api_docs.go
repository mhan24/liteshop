package web

import (
	"embed"
	"net/http"
)

//go:embed api_docs/openapi.json
var openapiFS embed.FS

// registerDocs 注册 /docs 与 /docs/openapi.json。
func (s *Server) registerDocs(mux *http.ServeMux) {
	// API 文档仅管理员可见，避免公开暴露完整接口面。
	mux.Handle("GET /docs/openapi.json", s.requireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		data, err := openapiFS.ReadFile("api_docs/openapi.json")
		if err != nil {
			http.Error(w, "openapi not found", 404)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_, _ = w.Write(data)
	})))
	mux.Handle("GET /docs", s.requireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(docsHTML))
	})))
}

// docsHTML 为纯本地文档页（无外部 CDN 依赖，避免供应链风险）。
const docsHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LiteShop API 文档</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 16px; color: #111; }
    a { color: #0f6b53; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 8px; overflow: auto; }
  </style>
</head>
<body>
  <h1>LiteShop API 文档</h1>
  <p>OpenAPI 3.0 规范：<a href="/docs/openapi.json">openapi.json</a></p>
  <p>可使用任意 OpenAPI 工具（如 Swagger UI / Postman）导入上述 JSON。</p>
</body>
</html>`
