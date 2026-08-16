package hashpay

import "encoding/json"

// hashPayCreateRequest 对应 HashPay POST /api/merchant/new 请求体。
type hashPayCreateRequest struct {
	MerchantNo  string  `json:"merchantNo"`
	Amount      float64 `json:"amount"`
	Currency    string  `json:"currency,omitempty"`
	Description string  `json:"description,omitempty"`
	ReturnURL   string  `json:"return_url,omitempty"`
}

// hashPayCreateResponse 对应 HashPay 创建订单响应。
type hashPayCreateResponse struct {
	CheckoutURL string `json:"checkoutUrl"`
	Order       struct {
		ID     string `json:"id"`
		Status string `json:"status"`
	} `json:"order"`
	Reused bool `json:"reused"`
}

// hashPayEnvelope 回调加密信封。
type hashPayEnvelope struct {
	Alg  string `json:"alg"`
	Key  string `json:"key"`
	IV   string `json:"iv"`
	Data string `json:"data"`
}

// hashPayCallback 解密后的回调明文。
type hashPayCallback struct {
	Timestamp int64 `json:"timestamp"`
	Payload   struct {
		OrderID    string          `json:"orderId"`
		MerchantNo string          `json:"merchantNo"`
		Amount     json.Number     `json:"amount"`
		Currency   string          `json:"currency"`
		Status     string          `json:"status"`
		Payment    json.RawMessage `json:"payment"`
	} `json:"payload"`
}

// txidFromPayment 从回调 payment 快照提取链上交易号（存在时用于对账）。
func txidFromPayment(raw json.RawMessage) string {
	if len(raw) == 0 || string(raw) == "null" {
		return ""
	}
	var snap struct {
		Tx struct {
			TxID string `json:"txid"`
		} `json:"tx"`
		OutID string `json:"out_id"`
	}
	if err := json.Unmarshal(raw, &snap); err != nil {
		return ""
	}
	if snap.Tx.TxID != "" {
		return snap.Tx.TxID
	}
	return snap.OutID
}
