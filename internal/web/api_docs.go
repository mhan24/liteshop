package web

import (
	"embed"
	"net/http"
)

//go:embed api_docs/openapi.json
var openapiFS embed.FS

// registerDocs 注册 /docs 与 /docs/openapi.json。
func (s *Server) registerDocs(mux *http.ServeMux) {
	mux.HandleFunc("GET /docs/openapi.json", func(w http.ResponseWriter, r *http.Request) {
		data, err := openapiFS.ReadFile("api_docs/openapi.json")
		if err != nil {
			http.Error(w, "openapi not found", 404)
			return
		}
		w.Header().Set("Content-Type", "application/json; charset=utf-8")
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_, _ = w.Write(data)
	})
	mux.HandleFunc("GET /docs", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		_, _ = w.Write([]byte(docsHTML))
	})
}

const docsHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LiteShop API Docs</title>
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui.css" />
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="https://cdn.jsdelivr.net/npm/swagger-ui-dist@5/swagger-ui-bundle.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/docs/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIBundle.SwaggerUIStandalonePreset],
      })
    }
  </script>
</body>
</html>`
