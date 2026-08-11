package api

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/security"
	"shop/internal/testutil"
)

// newHashPayCallbackServer 组装启用了 HashPay 密钥配置的测试服务器。
func newHashPayCallbackServer(t *testing.T) (*Server, *sql.DB, *repository.Store, string) {
	t.Helper()
	s, d := newCallbackServer(t)
	store := repository.NewStore(d)
	cipher := security.NewCipher(store.EnsureSessionSecret())
	privatePEM, _ := newHashPayKeys(t)
	if err := store.SetSecret("hashpay_private_key", privatePEM, cipher); err != nil {
		t.Fatalf("set hashpay private key: %v", err)
	}
	if err := store.SetSetting("hashpay_merchant_id", "merchant-1"); err != nil {
		t.Fatalf("set merchant id: %v", err)
	}
	return s, d, store, privatePEM
}

// newHashPayKeys 生成测试 RSA 密钥对。
func newHashPayKeys(t *testing.T) (privatePEM, publicPEM string) {
	t.Helper()
	key, err := rsa.GenerateKey(rand.Reader, 2048)
	if err != nil {
		t.Fatalf("generate key: %v", err)
	}
	privDER, _ := x509.MarshalPKCS8PrivateKey(key)
	privatePEM = string(pem.EncodeToMemory(&pem.Block{Type: "PRIVATE KEY", Bytes: privDER}))
	pubDER, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	publicPEM = string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))
	return privatePEM, publicPEM
}

// publicFromPrivate 从私钥推导 SPKI 公钥 PEM（与测试私钥配对）。
func publicFromPrivate(t *testing.T, privatePEM string) string {
	t.Helper()
	block, _ := pem.Decode([]byte(privatePEM))
	if block == nil {
		t.Fatal("invalid private key pem")
	}
	parsed, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatalf("parse private key: %v", err)
	}
	key := parsed.(*rsa.PrivateKey)
	pubDER, _ := x509.MarshalPKIXPublicKey(&key.PublicKey)
	return string(pem.EncodeToMemory(&pem.Block{Type: "PUBLIC KEY", Bytes: pubDER}))
}

// hashPayEnvelope 按 HashPay 服务端算法加密回调信封。
func hashPayEnvelope(t *testing.T, publicPEM string, payload []byte) []byte {
	t.Helper()
	pubBlock, _ := pem.Decode([]byte(publicPEM))
	pub, err := x509.ParsePKIXPublicKey(pubBlock.Bytes)
	if err != nil {
		t.Fatalf("parse public key: %v", err)
	}
	aesKey := make([]byte, 32)
	if _, err := rand.Read(aesKey); err != nil {
		t.Fatalf("aes key: %v", err)
	}
	encKey, err := rsa.EncryptOAEP(sha256.New(), rand.Reader, pub.(*rsa.PublicKey), aesKey, nil)
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
	raw, _ := json.Marshal(env)
	return raw
}

func hashPayPaidPayload(t *testing.T, orderNo, tradeID string, status string) []byte {
	t.Helper()
	raw, _ := json.Marshal(map[string]any{
		"timestamp": time.Now().Unix(),
		"payload": map[string]any{
			"orderId":    tradeID,
			"merchantNo": orderNo,
			"amount":     12.34,
			"currency":   "USD",
			"status":     status,
			"payment": map[string]any{
				"driver": "trc20",
				"tx":     map[string]any{"txid": "0xhash1", "confirmedBy": "system"},
			},
		},
	})
	return raw
}

// TestHashPayCallbackHTTP 真实路由：加密回调 → 支付成功发卡；重复回调幂等。
func TestHashPayCallbackHTTP(t *testing.T) {
	s, d, _, privatePEM := newHashPayCallbackServer(t)
	publicPEM := publicFromPrivate(t, privatePEM)

	pid := testutil.SeedProductWithCards(t, d, 2)
	orderNo := testutil.SeedOrder(t, d, pid, models.OrderWaitingPayment, "HP1")
	payload := hashPayEnvelope(t, publicPEM, hashPayPaidPayload(t, orderNo, "hp-1", "paid"))

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/notify/hashpay", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("hashpay callback status = %d, want 200", rec.Code)
	}
	repo := repository.NewOrderRepository(d)
	o, err := repo.GetOrderByNo(orderNo)
	if err != nil {
		t.Fatalf("get order: %v", err)
	}
	if o.Status != models.OrderDelivered {
		t.Fatalf("order status = %s, want delivered", o.Status)
	}
	if o.TradeID != "hp-1" || o.BlockTransactionID != "0xhash1" {
		t.Fatalf("trade_id=%q block_tx=%q", o.TradeID, o.BlockTransactionID)
	}
	cards, _ := repo.GetOrderCards(o.ID)
	if len(cards) != 1 {
		t.Fatalf("cards = %d, want 1", len(cards))
	}

	// 重复回调：仍 200，不发卡
	rec2 := httptest.NewRecorder()
	s.ServeHTTP(rec2, httptest.NewRequest(http.MethodPost, "/notify/hashpay", bytes.NewReader(payload)))
	if rec2.Code != http.StatusOK {
		t.Fatalf("duplicate hashpay callback status = %d, want 200", rec2.Code)
	}
	o2, _ := repo.GetOrderByNo(orderNo)
	cards2, _ := repo.GetOrderCards(o2.ID)
	if len(cards2) != 1 {
		t.Fatalf("duplicate callback changed cards: %d", len(cards2))
	}
}

// TestHashPayCallbackExpired 过期/无效回调 → 订单过期并释放库存。
func TestHashPayCallbackExpired(t *testing.T) {
	s, d, _, privatePEM := newHashPayCallbackServer(t)
	publicPEM := publicFromPrivate(t, privatePEM)

	pid := testutil.SeedProductWithCards(t, d, 2)
	orderNo := testutil.SeedOrder(t, d, pid, models.OrderWaitingPayment, "HP2")
	payload := hashPayEnvelope(t, publicPEM, hashPayPaidPayload(t, orderNo, "hp-2", "expired"))

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/notify/hashpay", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("expired callback status = %d, want 200", rec.Code)
	}
	repo := repository.NewOrderRepository(d)
	o, _ := repo.GetOrderByNo(orderNo)
	if o.Status != models.OrderExpired {
		t.Fatalf("order status = %s, want expired", o.Status)
	}
	keyRepo := repository.NewKeyRepository(d)
	avail, _ := keyRepo.AvailableCount(pid)
	if avail != 2 {
		t.Fatalf("available after expired callback = %d, want 2", avail)
	}
}

// TestHashPayCallbackBadEnvelope 伪造/错误信封被拒绝。
func TestHashPayCallbackBadEnvelope(t *testing.T) {
	s, d, _, _ := newHashPayCallbackServer(t)
	pid := testutil.SeedProductWithCards(t, d, 1)
	orderNo := testutil.SeedOrder(t, d, pid, models.OrderWaitingPayment, "HP3")

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/notify/hashpay", bytes.NewReader([]byte(`{"alg":"RSA-OAEP-256+A256GCM","key":"bad","iv":"bad","data":"bad"}`))))
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("bad envelope status = %d, want 400", rec.Code)
	}
	repo := repository.NewOrderRepository(d)
	o, _ := repo.GetOrderByNo(orderNo)
	if o.Status != models.OrderWaitingPayment {
		t.Fatalf("order must remain waiting_payment, got %s", o.Status)
	}
}

// TestHashPayNotifyPathRuntimeChange HashPay 回调路径后台修改后即时生效。
func TestHashPayNotifyPathRuntimeChange(t *testing.T) {
	s, d, store, privatePEM := newHashPayCallbackServer(t)
	if err := store.SetSetting("hashpay_notify_path", "/cb/hashpay-custom"); err != nil {
		t.Fatalf("set path: %v", err)
	}
	publicPEM := publicFromPrivate(t, privatePEM)

	pid := testutil.SeedProductWithCards(t, d, 1)
	orderNo := testutil.SeedOrder(t, d, pid, models.OrderWaitingPayment, "HP4")
	payload := hashPayEnvelope(t, publicPEM, hashPayPaidPayload(t, orderNo, "hp-4", "paid"))

	rec := httptest.NewRecorder()
	s.ServeHTTP(rec, httptest.NewRequest(http.MethodPost, "/cb/hashpay-custom", bytes.NewReader(payload)))
	if rec.Code != http.StatusOK {
		t.Fatalf("custom path callback status = %d, want 200", rec.Code)
	}
	repo := repository.NewOrderRepository(d)
	o, _ := repo.GetOrderByNo(orderNo)
	if o.Status != models.OrderDelivered {
		t.Fatalf("order status = %s, want delivered", o.Status)
	}
}
