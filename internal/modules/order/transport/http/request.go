package http

// createOrderRequest HTTP 请求模型（只描述 HTTP 契约，不携带领域/数据库字段）。
type createOrderRequest struct {
	ProductID         int64  `json:"product_id"`
	Qty               int    `json:"qty"`
	Contact           string `json:"contact"`
	TradeType         string `json:"trade_type"`
	Gateway           string `json:"gateway"`
	CouponCode        string `json:"coupon_code"`
	TurnstileResponse string `json:"cf-turnstile-response"`
}

// sendLinksRequest 发送查看链接请求（邮箱必填；订单号二选一：单个或批量）。
type sendLinksRequest struct {
	Contact  string   `json:"contact"`
	OrderNo  string   `json:"order_no"`
	OrderNos []string `json:"order_nos"`
}

// adminOrderStatusRequest 管理员改状态请求。
type adminOrderStatusRequest struct {
	Status  string `json:"status"`
	Message string `json:"message"`
}

// adminDeliverRequest 人工发货请求。
type adminDeliverRequest struct {
	Content string `json:"content"`
}

// batchResendRequest 批量重发请求。
type batchResendRequest struct {
	IDs []int64 `json:"ids"`
}
