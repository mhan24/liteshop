// Package contracts 存放对外契约（OpenAPI 规范），由 Go 内嵌供 /docs 提供。
package contracts

import "embed"

//go:embed openapi.json openapi.yaml
var FS embed.FS
