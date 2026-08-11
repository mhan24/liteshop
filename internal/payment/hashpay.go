package payment

import (
	"bytes"
	"crypto"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// HashPay 是 Gateway 的 HashPay 实现。
//
// HashPay 运行在 Cloudflare Workers 上：创建订单使用商户私钥做
// RSASSA-PKCS1-v1_5 SHA-256 签名；回调通知使用 RSA-OAEP-256+A256GCM
// 加密信封，需用商户私钥解密后读取订单状态。
type HashPay struct {
	BaseURL    string
	MerchantID string
	PrivateKey string // PEM 私钥（PKCS#8 或 PKCS#1，创建商户时仅显示一次）
	Currency   string // 请求默认货币（USD 等），为空时使用 CreateInput.Fiat
	HTTP       *http.Client
}

// 编译期断言：HashPay 必须实现 Gateway。
var _ Gateway = (*HashPay)(nil)

func NewHashPay(baseURL, merchantID, privateKey, currency string) *HashPay {
	return &HashPay{
		BaseURL:    strings.TrimRight(baseURL, "/"),
		MerchantID: strings.TrimSpace(merchantID),
		PrivateKey: privateKey,
		Currency:   strings.ToUpper(strings.TrimSpace(currency)),
		HTTP:       &http.Client{Timeout: 15 * time.Second},
	}
}

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

// CreateTransaction 创建 HashPay 支付订单，返回收银台地址与 HashPay 订单 ID。
func (c *HashPay) CreateTransaction(in CreateInput) (string, string, error) {
	if c.MerchantID == "" || c.PrivateKey == "" {
		return "", "", ErrGatewayNotConfigured
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
// 由 HashPay 自身处理，这里返回 nil（调用方忽略结果）。
func (c *HashPay) CancelTransaction(tradeID string) error {
	return nil
}

// VerifyCallback 解密并校验 HashPay 回调信封（RSA-OAEP-256+A256GCM），
// 返回统一参数：order_id=商户订单号、trade_id=HashPay 订单 ID、
// status=paid/pending/expired/invalid，以及可选链上交易号。
func (c *HashPay) VerifyCallback(body []byte) (CallbackParams, error) {
	if c.PrivateKey == "" {
		return nil, ErrGatewayNotConfigured
	}
	var env hashPayEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return nil, fmt.Errorf("invalid hashpay envelope: %w", err)
	}
	if env.Alg != "RSA-OAEP-256+A256GCM" {
		return nil, fmt.Errorf("unsupported hashpay encryption algorithm: %q", env.Alg)
	}
	plain, err := decryptCallbackEnvelope(c.PrivateKey, env)
	if err != nil {
		return nil, fmt.Errorf("hashpay callback decrypt: %w", err)
	}
	var cb hashPayCallback
	if err := json.Unmarshal(plain, &cb); err != nil {
		return nil, fmt.Errorf("invalid hashpay callback payload: %w", err)
	}
	// 时间戳窗口 ±5 分钟（与 HashPay 服务端验签窗口一致），防止重放。
	now := time.Now().Unix()
	if cb.Timestamp == 0 || now-cb.Timestamp > 300 || cb.Timestamp-now > 300 {
		return nil, fmt.Errorf("hashpay callback timestamp out of window: ts=%d now=%d", cb.Timestamp, now)
	}
	if cb.Payload.MerchantNo == "" || cb.Payload.OrderID == "" {
		return nil, errors.New("hashpay callback payload missing order id")
	}
	params := CallbackParams{
		"order_id": cb.Payload.MerchantNo,
		"trade_id": cb.Payload.OrderID,
		"status":   cb.Payload.Status,
		"amount":   cb.Payload.Amount.String(),
		"currency": cb.Payload.Currency,
	}
	if tx := txidFromPayment(cb.Payload.Payment); tx != "" {
		params["block_transaction_id"] = tx
	}
	return params, nil
}

// signedRequest 构造带 RSA 签名的请求（签名原文：method\npath\ntimestamp\nbody）。
func (c *HashPay) signedRequest(method, path string, body []byte) (*http.Request, error) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	payload := strings.Join([]string{method, path, ts, string(body)}, "\n")
	sig, err := rsaSignSHA256(c.PrivateKey, []byte(payload))
	if err != nil {
		return nil, fmt.Errorf("hashpay sign request: %w", err)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Merchant-Id", c.MerchantID)
	req.Header.Set("X-Timestamp", ts)
	req.Header.Set("X-Signature", base64.StdEncoding.EncodeToString(sig))
	return req, nil
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

// decryptCallbackEnvelope 用商户私钥解出 AES-256 内容密钥，再 AES-GCM 解密 data。
func decryptCallbackEnvelope(privateKeyPEM string, env hashPayEnvelope) ([]byte, error) {
	key, err := parsePrivateKeyPEM(privateKeyPEM)
	if err != nil {
		return nil, err
	}
	encKey, err := base64Decode(env.Key)
	if err != nil {
		return nil, fmt.Errorf("decode key: %w", err)
	}
	aesKey, err := rsa.DecryptOAEP(sha256.New(), rand.Reader, key, encKey, nil)
	if err != nil {
		return nil, fmt.Errorf("decrypt aes key: %w", err)
	}
	if len(aesKey) != 32 {
		return nil, fmt.Errorf("unexpected aes key length %d", len(aesKey))
	}
	iv, err := base64Decode(env.IV)
	if err != nil {
		return nil, fmt.Errorf("decode iv: %w", err)
	}
	data, err := base64Decode(env.Data)
	if err != nil {
		return nil, fmt.Errorf("decode data: %w", err)
	}
	block, err := aes.NewCipher(aesKey)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	if len(iv) != gcm.NonceSize() {
		return nil, fmt.Errorf("unexpected iv length %d", len(iv))
	}
	plain, err := gcm.Open(nil, iv, data, nil)
	if err != nil {
		return nil, fmt.Errorf("aes-gcm decrypt: %w", err)
	}
	return plain, nil
}

// rsaSignSHA256 使用 RSA 私钥做 RSASSA-PKCS1-v1_5 SHA-256 签名。
func rsaSignSHA256(privateKeyPEM string, message []byte) ([]byte, error) {
	key, err := parsePrivateKeyPEM(privateKeyPEM)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(message)
	return rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
}

// parsePrivateKeyPEM 解析 PKCS#8 或 PKCS#1 格式的 RSA 私钥。
func parsePrivateKeyPEM(raw string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, errors.New("invalid RSA private key PEM")
	}
	if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if rk, ok := k.(*rsa.PrivateKey); ok {
			return rk, nil
		}
		return nil, errors.New("private key is not RSA")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	return nil, errors.New("invalid RSA private key (expected PKCS#8 or PKCS#1 PEM)")
}

// base64Decode 解码 Base64（兼容 HashPay 可能带换行的输出）。
func base64Decode(s string) ([]byte, error) {
	cleaned := strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\r', ' ', '\t':
			return -1
		}
		return r
	}, s)
	return base64.StdEncoding.DecodeString(cleaned)
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

// truncate 截断网关响应体，避免错误日志刷屏（保留协议体便于排障）。
func truncate(s string) string {
	const max = 512
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}
