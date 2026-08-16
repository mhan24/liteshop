package bepusdt

// createResponse 创建交易响应结构。
type createResponse struct {
	StatusCode int    `json:"status_code"`
	Message    string `json:"message"`
	Data       struct {
		TradeID    string `json:"trade_id"`
		OrderID    string `json:"order_id"`
		PaymentURL string `json:"payment_url"`
	} `json:"data"`
}

// cancelResponse 关闭交易响应结构。
type cancelResponse struct {
	StatusCode int    `json:"status_code"`
	Message    string `json:"message"`
}
