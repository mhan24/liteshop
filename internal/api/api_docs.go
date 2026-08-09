package api

import (
	"embed"
	"net/http"
)

//go:embed api_docs/openapi.json api_docs/openapi.yaml
var openapiFS embed.FS

// registerDocs 注册 API 文档：/docs 与 /swagger（别名），
// 提供 openapi.json / openapi.yaml 两种格式，仅管理员可见。
func (s *Server) registerDocs(mux *http.ServeMux) {
	serveSpec := func(w http.ResponseWriter, r *http.Request, name, contentType string) {
		data, err := openapiFS.ReadFile("api_docs/" + name)
		if err != nil {
			http.Error(w, "openapi not found", 404)
			return
		}
		w.Header().Set("Content-Type", contentType)
		w.Header().Set("Cache-Control", "public, max-age=3600")
		_, _ = w.Write(data)
	}
	for _, base := range []string{"/docs", "/swagger"} {
		b := base
		mux.Handle("GET "+b+"/openapi.json", s.requireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveSpec(w, r, "openapi.json", "application/json; charset=utf-8")
		})))
		mux.Handle("GET "+b+"/openapi.yaml", s.requireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			serveSpec(w, r, "openapi.yaml", "application/yaml; charset=utf-8")
		})))
		mux.Handle("GET "+b, s.requireAdmin(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			w.Header().Set("Content-Type", "text/html; charset=utf-8")
			_, _ = w.Write([]byte(docsHTML))
		})))
	}
}

// docsHTML 为纯本地文档页（无外部 CDN 依赖，避免供应链风险）。
const docsHTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>LiteShop API 文档</title>
  <style>
    body { font-family: system-ui, -apple-system, sans-serif; max-width: 760px; margin: 40px auto; padding: 0 16px; color: #111; line-height: 1.6; }
    a { color: #0f6b53; }
    pre { background: #f5f5f5; padding: 12px; border-radius: 8px; overflow: auto; }
    code { background: #f0f0f0; padding: 1px 5px; border-radius: 4px; }
    table { border-collapse: collapse; width: 100%; }
    td, th { border: 1px solid #ddd; padding: 6px 10px; text-align: left; font-size: 14px; }
  </style>
</head>
<body>
  <h1>LiteShop API 文档</h1>
  <p>本页面仅管理员可见，需先登录后台（<code>/admin</code>）。</p>
  <table>
    <tr><th>资源</th><th>说明</th></tr>
    <tr><td><a href="/docs/openapi.json">openapi.json</a></td><td>OpenAPI 3.0 JSON（Swagger UI / Postman 等可直接导入）</td></tr>
    <tr><td><a href="/docs/openapi.yaml">openapi.yaml</a></td><td>同规范的 YAML 版本</td></tr>
    <tr><td><a href="/swagger">/swagger</a></td><td>本文档页的别名入口</td></tr>
  </table>
  <h2>导入方式</h2>
  <pre># Swagger UI / Postman
导入 URL: https://你的域名/docs/openapi.json</pre>
  <h2>接口分组</h2>
  <ul>
    <li><strong>public</strong>：前台公开端点（站点 / 商品 / 下单 / 订单查询 / 初始化 / 健康检查）</li>
    <li><strong>admin</strong>：管理端点（需会话 Cookie；角色：viewer &lt; operator &lt; admin）</li>
    <li><strong>webhook</strong>：支付网关回调（默认 /notify/bepusdt，路径可在后台配置）</li>
  </ul>
  <h2>注意事项</h2>
  <ul>
    <li>订单查看链接与卡密访问：使用邮件下发的 <code>token</code> 查询参数，公开接口不下发订单号/链接</li>
    <li>敏感配置（支付 Token / SMTP 密码 / Turnstile 密钥）仅返回"是否已配置"，不会回显明文</li>
    <li>修改接口后请同步更新 <code>internal/api/api_docs/openapi.json</code>（及生成的 yaml）</li>
  </ul>
</body>
</html>`
