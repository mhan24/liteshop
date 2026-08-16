// Package bepusdt 实现 order 应用层声明的 PaymentGateway 端口。
package bepusdt

import (
	"net/http"
	"strings"
	"time"

	orderapp "shop/internal/modules/order/application"
)

// Client BEpusdt 网关客户端（实现 orderapp.PaymentGateway）。
type Client struct {
	baseURL    string
	apiToken   string
	httpClient *http.Client
}

// 编译期断言：Client 必须实现 orderapp.PaymentGateway。
var _ orderapp.PaymentGateway = (*Client)(nil)

// NewClient 创建 BEpusdt 客户端。
func NewClient(baseURL, apiToken string) *Client {
	return &Client{
		baseURL:    strings.TrimRight(baseURL, "/"),
		apiToken:   apiToken,
		httpClient: &http.Client{Timeout: 15 * time.Second},
	}
}
