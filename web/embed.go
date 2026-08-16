//go:build production

// Package web 承载前端构建产物（admin SPA 由 Go 内嵌提供；storefront 独立部署）。
package web

import (
	"embed"
	"io/fs"
	"net/http"
)

//go:embed admin/dist
var assets embed.FS

// Index 返回管理端入口页面。
func Index() ([]byte, error) { return assets.ReadFile("admin/dist/index.html") }

// FS 返回 admin 构建产物（admin/dist）根文件系统。
func FS() http.FileSystem {
	sub, err := fs.Sub(assets, "admin/dist")
	if err != nil {
		return http.FS(assets)
	}
	return http.FS(sub)
}
