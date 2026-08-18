package hashpay

import (
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
	"net/http/httptest"
	orderapp "shop/internal/modules/order/application"
	"strings"
	"testing"
	"time"
)

// newHashPayTestKeys 生成测试 RSA 密钥对（PKCS#8 私钥 + SPKI 公钥，与 HashPay 一致）。
func newHashPayTestKeys(t *testing.T) (privatePEM, publicPEM string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	privDER, err := x509.MarshalPKCS8PrivateKey(key)
	if err != nil {
		t.Fatalf("marshal private key: %v", err)
	}
	privatePEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER}))
	pubDER, err := x509.MarshalPKIXPublicKey(&key.PublicKey)
	if err != nil {
		t.Fatalf("marshal public key: %v", err)
	}
	publicPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))
	return privatePEM, publicPEM
}

// encryptHashPayCallback 按 HashPay 服务端实现加密回调信封（RSA-OAEP-256 + AES-256-GCM）。
func encryptHashPayCallback(t *testing.T, publicPEM string, payload []byte) []byte {
	t.Helper()
	pubBlock, _ := pem.Decode([]byte(publicPEM))
	pub, err := x509.ParsePKIXPublicKey(pubBlock.Bytes)
	if err != nil {
		t.Fatalf("parse public key: %v", err)
	}
	rsaPub := pub.(*rsa.PublicKey)
	aesKey := make([]byte, 32)
	if _, err := rand.Read(aesKey); err != nil {
		t.Fatalf("aes key: %v", err)
	}
	encKey, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, rsaPub, aesKey, nil)
	if err != nil {
		t.Fatalf("encrypt key: %v", err)
	}
	block, _ := aes.NewCipher(aesKey)
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		t.Fatalf("new gcm: %v", err)
	}
	iv := make([]byte, gcm.NonceSize())
	if _, err := rand.Read(iv); err != nil {
		t.Fatalf("iv: %v", err)
	}
	env := map[string]string{
		"alg":  "RSA-OAEP-256+A256GCM",
		"key":  base64.StdEncoding.EncodeToString(encKey),
		"iv":   base64.StdEncoding.EncodeToString(iv),
		"data": base64.StdEncoding.EncodeToString(gcm.Seal(nil, iv, payload, nil)),
	}
	raw, err := json.Marshal(env)
	if err != nil {
		t.Fatalf("marshal envelope: %v", err)
	}
	return raw
}

func TestHashPaySigning(t *testing.T) {
	privatePEM, publicPEM := newHashPayTestKeys(t)
	pubBlock, _ := pem.Decode([]byte(publicPEM))
	pub, err := x509.ParsePKIXPublicKey(pubBlock.Bytes)
	if err != nil {
		t.Fatalf("parse public key: %v", err)
	}
	ts := fmt.Sprint(time.Now().Unix())
	body := `{"merchantNo":"ORD-1","amount":1,"currency":"USD"}`
	signed := strings.Join([]string{"POST", "/api/merchant/new", ts, body}, "\n")
	sig, err := rsaSignSHA256(privatePEM, []byte(signed))
	if err != nil {
		t.Fatalf("sign: %v", err)
	}
	sum := sha256.Sum256([]byte(signed))
	if err := rsa.VerifyPKCS1v15(pub.(*rsa.PublicKey), crypto.SHA256, sum[:], sig); err != nil {
		t.Fatalf("verify signature: %v", err)
	}
	// 篡改原文（时间戳/路径/body 任一变化）必须验签失败。
	tampered := strings.Join([]string{"POST", "/api/merchant/new", ts, body + "x"}, "\n")
	sum2 := sha256.Sum256([]byte(tampered))
	if err := rsa.VerifyPKCS1v15(pub.(*rsa.PublicKey), crypto.SHA256, sum2[:], sig); err == nil {
		t.Fatal("tampered payload must fail verification")
	}
}

func TestHashPayVerifyCallback(t *testing.T) {
	privatePEM, publicPEM := newHashPayTestKeys(t)
	payload, _ := json.Marshal(map[string]any{
		"timestamp": time.Now().Unix(),
		"payload": map[string]any{
			"orderId":    "hp-123",
			"merchantNo": "ORD-10001",
			"amount":     12.34,
			"currency":   "USD",
			"status":     "paid",
			"payment": map[string]any{
				"tx": map[string]any{"txid": "0xabc", "confirmedBy": "system"},
			},
		},
	})
	env := encryptHashPayCallback(t, publicPEM, payload)
	gw := NewHashPay("https://pay.example.com", "merchant-1", privatePEM, "USD")
	cb, err := gw.VerifyCallback(env)
	if err != nil {
		t.Fatalf("verify callback: %v", err)
	}
	if cb.OrderID != "ORD-10001" {
		t.Fatalf("order_id = %q, want ORD-10001", cb.OrderID)
	}
	if cb.TradeID != "hp-123" {
		t.Fatalf("trade_id = %q, want hp-123", cb.TradeID)
	}
	if cb.Status != orderapp.PaymentTxPaid {
		t.Fatalf("status = %q, want paid", cb.Status)
	}
	if cb.BlockTransactionID != "0xabc" {
		t.Fatalf("block_transaction_id = %q, want 0xabc", cb.BlockTransactionID)
	}
}

func TestHashPayVerifyCallbackErrors(t *testing.T) {
	privatePEM, publicPEM := newHashPayTestKeys(t)
	gw := NewHashPay("https://pay.example.com", "merchant-1", privatePEM, "USD")

	// 时间戳超出 ±5 分钟窗口。
	stale, _ := json.Marshal(map[string]any{
		"timestamp": time.Now().Unix() - 301,
		"payload": map[string]any{
			"orderId": "hp-1", "merchantNo": "ORD-1", "amount": 1, "currency": "USD", "status": "paid",
		},
	})
	if _, err := gw.VerifyCallback(encryptHashPayCallback(t, publicPEM, stale)); err == nil {
		t.Fatal("stale timestamp must fail")
	}

	// 不支持的加密算法。
	badAlg, _ := json.Marshal(map[string]string{"alg": "AES", "key": "a", "iv": "b", "data": "c"})
	if _, err := gw.VerifyCallback(badAlg); err == nil {
		t.Fatal("unsupported alg must fail")
	}

	// 非法 JSON。
	if _, err := gw.VerifyCallback([]byte("not-json")); err == nil {
		t.Fatal("invalid body must fail")
	}

	// 未配置私钥。
	empty := NewHashPay("https://pay.example.com", "merchant-1", "", "USD")
	if _, err := empty.VerifyCallback([]byte(`{}`)); err != orderapp.ErrGatewayNotConfigured {
		t.Fatalf("unconfigured gateway error = %v", err)
	}
}

func TestHashPayCreateTransaction(t *testing.T) {
	privatePEM, publicPEM := newHashPayTestKeys(t)
	var gotHeaders http.Header
	var gotPath string
	var gotBody []byte
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		gotPath = r.URL.Path
		gotHeaders = r.Header.Clone()
		gotBody, _ = io.ReadAll(r.Body)
		_, _ = w.Write([]byte(`{"checkoutUrl":"https://pay.hashpay.test/pay/abc","order":{"id":"hp-abc","status":"pending"},"reused":false}`))
	}))
	defer srv.Close()

	gw := NewHashPay(srv.URL, "merchant-1", privatePEM, "USD")
	url, tradeID, err := gw.CreateTransaction(orderapp.CreateInput{
		OrderID:     "ORD-10001",
		Amount:      12.34,
		Fiat:        "USD",
		TradeType:   "usdt.trc20",
		Name:        "测试商品",
		NotifyURL:   "https://shop.test/notify/hashpay",
		RedirectURL: "https://shop.test/order/ORD-10001",
		TimeoutSec:  1200,
	})
	if err != nil {
		t.Fatalf("create transaction: %v", err)
	}
	if url != "https://pay.hashpay.test/pay/abc" || tradeID != "hp-abc" {
		t.Fatalf("url=%q tradeID=%q", url, tradeID)
	}
	if gotPath != "/api/merchant/new" {
		t.Fatalf("path = %q", gotPath)
	}
	if gotHeaders.Get("X-Merchant-Id") != "merchant-1" {
		t.Fatalf("merchant header = %q", gotHeaders.Get("X-Merchant-Id"))
	}
	if gotHeaders.Get("X-Signature") == "" || gotHeaders.Get("X-Timestamp") == "" {
		t.Fatal("signature/timestamp headers missing")
	}
	// 服务端用公钥校验签名原文。
	pubBlock, _ := pem.Decode([]byte(publicPEM))
	pub, _ := x509.ParsePKIXPublicKey(pubBlock.Bytes)
	signed := strings.Join([]string{"POST", "/api/merchant/new", gotHeaders.Get("X-Timestamp"), string(gotBody)}, "\n")
	sig, err := base64.StdEncoding.DecodeString(gotHeaders.Get("X-Signature"))
	if err != nil {
		t.Fatalf("decode signature: %v", err)
	}
	sum := sha256.Sum256([]byte(signed))
	if err := rsa.VerifyPKCS1v15(pub.(*rsa.PublicKey), crypto.SHA256, sum[:], sig); err != nil {
		t.Fatalf("server-side signature verify: %v", err)
	}
	var bodyObj map[string]any
	_ = json.Unmarshal(gotBody, &bodyObj)
	if bodyObj["merchantNo"] != "ORD-10001" || bodyObj["currency"] != "USD" {
		t.Fatalf("unexpected body: %s", gotBody)
	}
}

func TestHashPayCancelQueriesStatus(t *testing.T) {
	privatePEM, _ := newHashPayTestKeys(t)
	// pending：不能提前本地取消，等待 HashPay 到期回调。
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/order/hp-1" || r.Method != http.MethodGet {
			t.Fatalf("unexpected request: %s %s", r.Method, r.URL.Path)
		}
		if r.Header.Get("X-Merchant-Id") == "" || r.Header.Get("X-Signature") == "" {
			t.Fatal("signature headers missing on cancel query")
		}
		_, _ = w.Write([]byte(`{"status":"pending"}`))
	}))
	defer srv.Close()
	gw := NewHashPay(srv.URL, "merchant-1", privatePEM, "USD")
	if err := gw.CancelTransaction("hp-1"); !errors.Is(err, orderapp.ErrHashPayPending) {
		t.Fatalf("pending cancel error = %v, want orderapp.ErrHashPayPending", err)
	}

	// paid：取消与付款竞态。
	srv2 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(`{"status":"paid"}`))
	}))
	defer srv2.Close()
	gw2 := NewHashPay(srv2.URL, "merchant-1", privatePEM, "USD")
	if err := gw2.CancelTransaction("hp-2"); !errors.Is(err, orderapp.ErrHashPayAlreadyPaid) {
		t.Fatalf("paid cancel error = %v, want orderapp.ErrHashPayAlreadyPaid", err)
	}

	// 网关返回错误。
	srv3 := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, `{"error":{"key":"errors.order_not_found"}}`, http.StatusNotFound)
	}))
	defer srv3.Close()
	gw3 := NewHashPay(srv3.URL, "merchant-1", privatePEM, "USD")
	if err := gw3.CancelTransaction("hp-3"); err == nil {
		t.Fatal("gateway error should propagate")
	}

	// 未配置。
	empty := NewHashPay("https://pay.example.com", "", "", "USD")
	if err := empty.CancelTransaction("hp-4"); err != orderapp.ErrGatewayNotConfigured {
		t.Fatalf("unconfigured cancel error = %v", err)
	}
}
