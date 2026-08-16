package hashpay

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	orderapp "shop/internal/modules/order/application"
	"strings"
	"time"
)

// HashPay 是 orderapp.PaymentGateway 的 HashPay 实现。
//
// HashPay 运行在 Cloudflare Workers 上：创建订单使用商户私钥做
// RSASSA-PKCS1-v1_5 SHA-256 签名；回调通知使用 RSA-OAEP-256+A256GCM
// 加密信封，需用商户私钥解密后读取订单状态。
type HashPay struct {
	BaseURL    string
	MerchantID string
	PrivateKey string // PEM 私钥（PKCS#8 或 PKCS#1，创建商户时仅显示一次）
	Currency   string // 请求默认货币（USD 等），为空时使用 orderapp.CreateInput.Fiat
	HTTP       *http.Client
}

// 编译期断言：HashPay 必须实现 orderapp.PaymentGateway。
var _ orderapp.PaymentGateway = (*HashPay)(nil)

func NewHashPay(baseURL, merchantID, privateKey, currency string) *HashPay {
	return &HashPay{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		MerchantID: strings.TrimSpace(merchantID),
		PrivateKey: privateKey,
		Currency:   strings.ToUpper(strings.TrimSpace(currency)),
		HTTP:       &http.Client{Timeout: 15 * time.Second},
	}
}

// CreateTransaction 创建 HashPay 支付订单，返回收银台地址与 HashPay 订单 ID。
func (c *HashPay) CreateTransaction(in orderapp.CreateInput) (string, string, error) {
	if c.MerchantID == "" || c.PrivateKey == "" {
		return "", "", orderapp.ErrGatewayNotConfigured
	}
	currency := c.Currency
	if currency == "" {
		currency = strings.ToUpper(strings.TrimSpace(in.Fiat))
	}
	body, err := json.Marshal(hashPayCreateRequest{
		MerchantNo:  in.OrderID,
		Amount:      in.Amount,
		Currency:    currency,
		Description: in.Name,
		ReturnURL:   in.RedirectURL,
	})
	if err != nil {
		return "", "", err
	}
	req, err := c.signedRequest(http.MethodPost, "/api/merchant/new", body)
	if err != nil {
		return "", "", err
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out hashPayCreateResponse
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", "", fmt.Errorf("decode hashpay response: %w; body=%s", err, truncate(string(respBody)))
	}
	if out.CheckoutURL == "" || out.Order.ID == "" {
		return "", "", fmt.Errorf("hashpay create transaction failed: status=%d body=%s", resp.StatusCode, truncate(string(respBody)))
	}
	return out.CheckoutURL, out.Order.ID, nil
}

// CancelTransaction 关闭交易。HashPay 协议未提供商户侧取消接口，订单过期
// 由 HashPay 自身处理；这里主动查询订单状态以检测"取消与付款竞态"：
// 已支付返回 orderapp.ErrHashPayAlreadyPaid（调用方告警），其余状态等待 HashPay 到期回调兜底。
func (c *HashPay) CancelTransaction(tradeID string) error {
	if c.MerchantID == "" || c.PrivateKey == "" {
		return orderapp.ErrGatewayNotConfigured
	}
	if tradeID == "" {
		return nil
	}
	status, err := c.QueryOrderStatus(tradeID)
	if err != nil {
		return fmt.Errorf("hashpay cancel check: %w", err)
	}
	if status == "paid" {
		return orderapp.ErrHashPayAlreadyPaid
	}
	return nil
}

// QueryOrderStatus 查询 HashPay 订单状态（GET /api/order/:orderId，签名时 body 为空）。
// 返回 pending / paid / expired / invalid。
func (c *HashPay) QueryOrderStatus(orderID string) (string, error) {
	if c.MerchantID == "" || c.PrivateKey == "" {
		return "", orderapp.ErrGatewayNotConfigured
	}
	if orderID == "" {
		return "", errors.New("hashpay order id is empty")
	}
	req, err := c.signedRequest(http.MethodGet, "/api/order/"+orderID, nil)
	if err != nil {
		return "", err
	}
	resp, err := c.HTTP.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	respBody, _ := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	var out struct {
		Status string `json:"status"`
	}
	if err := json.Unmarshal(respBody, &out); err != nil {
		return "", fmt.Errorf("decode hashpay order status: %w; body=%s", err, truncate(string(respBody)))
	}
	if resp.StatusCode != http.StatusOK || out.Status == "" {
		return "", fmt.Errorf("hashpay query order failed: status=%d body=%s", resp.StatusCode, truncate(string(respBody)))
	}
	return out.Status, nil
}
