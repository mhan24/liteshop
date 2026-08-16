package hashpay

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"encoding/json"
	"errors"
	"fmt"
	orderapp "shop/internal/modules/order/application"
	"strings"
	"time"
)

// VerifyCallback 解密并校验 HashPay 回调信封（RSA-OAEP-256+A256GCM），
// 返回统一参数：order_id=商户订单号、trade_id=HashPay 订单 ID、
// status=paid/pending/expired/invalid，以及可选链上交易号。
func (c *HashPay) VerifyCallback(body []byte) (orderapp.PaymentCallback, error) {
	if c.PrivateKey == "" {
		return orderapp.PaymentCallback{}, orderapp.ErrGatewayNotConfigured
	}
	var env hashPayEnvelope
	if err := json.Unmarshal(body, &env); err != nil {
		return orderapp.PaymentCallback{}, fmt.Errorf("invalid hashpay envelope: %w", err)
	}
	if env.Alg != "RSA-OAEP-256+A256GCM" {
		return orderapp.PaymentCallback{}, fmt.Errorf("unsupported hashpay encryption algorithm: %q", env.Alg)
	}
	plain, err := decryptCallbackEnvelope(c.PrivateKey, env)
	if err != nil {
		return orderapp.PaymentCallback{}, fmt.Errorf("hashpay callback decrypt: %w", err)
	}
	var cb hashPayCallback
	if err := json.Unmarshal(plain, &cb); err != nil {
		return orderapp.PaymentCallback{}, fmt.Errorf("invalid hashpay callback payload: %w", err)
	}
	// 时间戳窗口 ±5 分钟（与 HashPay 服务端验签窗口一致），防止重放。
	now := time.Now().Unix()
	if cb.Timestamp == 0 || now-cb.Timestamp > 300 || cb.Timestamp-now > 300 {
		return orderapp.PaymentCallback{}, fmt.Errorf("hashpay callback timestamp out of window: ts=%d now=%d", cb.Timestamp, now)
	}
	if cb.Payload.MerchantNo == "" || cb.Payload.OrderID == "" {
		return orderapp.PaymentCallback{}, errors.New("hashpay callback payload missing order id")
	}
	return orderapp.PaymentCallback{
		OrderID:            cb.Payload.MerchantNo,
		TradeID:            cb.Payload.OrderID,
		BlockTransactionID: txidFromPayment(cb.Payload.Payment),
		Amount:             cb.Payload.Amount.String(),
		Currency:           cb.Payload.Currency,
		Status:             normalizeHashPayStatus(cb.Payload.Status),
	}, nil
}

// normalizeHashPayStatus 把 HashPay 原始状态归一化为内部支付状态。
func normalizeHashPayStatus(raw string) orderapp.PaymentTxStatus {
	switch strings.TrimSpace(raw) {
	case "paid":
		return orderapp.PaymentTxPaid
	case "expired", "invalid", "cancelled":
		return orderapp.PaymentTxClosed
	default:
		return orderapp.PaymentTxPending
	}
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

// truncate 截断网关响应体，避免错误日志刷屏（保留协议体便于排障）。
func truncate(s string) string {
	const max = 512
	if len(s) <= max {
		return s
	}
	return s[:max] + "...(truncated)"
}
