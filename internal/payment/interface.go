// Package payment 定义支付网关抽象：业务层只依赖 Gateway 接口，不绑定具体网关。
//
// 目前内置实现为 BEpusdt（bepusdt.go）。后续接入其他 USDT 网关 / Stripe /
// PayPal 等，只需新增实现 Gateway 的适配器，订单业务与回调处理无需改动。
package payment

import "errors"

// Gateway 统一支付网关接口。
type Gateway interface {
	// CreateTransaction 创建支付交易，返回收银台地址与交易 ID。
	CreateTransaction(in CreateInput) (paymentURL, tradeID string, err error)
	// CancelTransaction 关闭指定交易（取消/过期订单时调用）。
	CancelTransaction(tradeID string) error
	// VerifyCallback 校验支付网关回调签名并解析参数。
	VerifyCallback(body []byte) (CallbackParams, error)
}

// CreateInput 创建交易输入（网关无关的最小集合）。
type CreateInput struct {
	OrderID     string  // 订单号（对账主键）
	Amount      float64 // 法币金额（元）
	Fiat        string  // 法币代码（CNY/USD 等）
	TradeType   string  // 收款类型（BEpusdt 使用；无此概念的网关可留空）
	Name        string  // 商品名称
	NotifyURL   string  // 支付结果异步回调地址
	RedirectURL string  // 支付完成后跳转地址
	TimeoutSec  int     // 交易超时秒数
}

// CallbackParams 支付回调解析结果（网关字段统一为字符串）。
type CallbackParams map[string]string

// ErrGatewayNotConfigured 网关凭据未配置。
var ErrGatewayNotConfigured = errors.New("payment gateway is not configured")
