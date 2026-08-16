//go:build !production

package web

import (
	"embed"
	"io/fs"
	"net/http"
)

// 默认构建使用占位页，使后端测试和静态分析不依赖前端构建产物。
// 正式发布必须使用 -tags production，将实际 web/admin/dist 内嵌。
//
//go:embed placeholder
var assets embed.FS

func Index() ([]byte, error) { return assets.ReadFile("placeholder/index.html") }

func FS() http.FileSystem {
	sub, err := fs.Sub(assets, "placeholder")
	if err != nil {
		return http.FS(assets)
	}
	return http.FS(sub)
}
