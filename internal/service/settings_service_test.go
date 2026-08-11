package service

import (
	"testing"

	"shop/internal/config"
	"shop/internal/security"
)

// stubSettingsStore 内存版 SettingsStore，验证 service 可脱离 SQLite 独立测试。
type stubSettingsStore struct {
	settings map[string]string
	secrets  map[string]string
	keys     []string
}

func newStubSettingsStore() *stubSettingsStore {
	return &stubSettingsStore{
		settings: map[string]string{},
		secrets:  map[string]string{},
		keys:     []string{"bepusdt_api_token", "smtp_password", "telegram_bot_token", "webhook_secret", "turnstile_secret", "maintenance_password", "hashpay_private_key"},
	}
}

func (s *stubSettingsStore) GetSetting(key string) (string, error)   { return s.settings[key], nil }
func (s *stubSettingsStore) SetSetting(key, value string) error      { s.settings[key] = value; return nil }
func (s *stubSettingsStore) AllSettings() (map[string]string, error) { return s.settings, nil }
func (s *stubSettingsStore) GetSecret(key string, _ *security.Cipher) (string, error) {
	return s.secrets[key], nil
}
func (s *stubSettingsStore) SetSecret(key, value string, _ *security.Cipher) error {
	s.secrets[key] = value
	return nil
}
func (s *stubSettingsStore) SecretKeys() []string  { return s.keys }
func (s *stubSettingsStore) ResetAllTables() error { return nil }
func (s *stubSettingsStore) SettingsVersion() int  { return 1 }

// TestSettingsServiceSavePaymentWithStub 用内存 stub 验证支付配置保存：
// 普通配置进 settings，敏感 Token 走 secrets，法币/收款类型规范化。
func TestSettingsServiceSavePaymentWithStub(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SavePayment(map[string]any{
		"bepusdt_base_url":    "https://pay.example.com",
		"fiat":                "cny",
		"trade_types":         "usdt.trc20, usdt.erc20",
		"bepusdt_timeout_sec": "1200",
		"bepusdt_api_token":   "tok123",
	}); err != nil {
		t.Fatalf("save payment: %v", err)
	}
	if st.settings["bepusdt_base_url"] != "https://pay.example.com" {
		t.Fatalf("base url = %q", st.settings["bepusdt_base_url"])
	}
	if st.settings["bepusdt_fiat"] != "CNY" {
		t.Fatalf("fiat = %q", st.settings["bepusdt_fiat"])
	}
	if st.settings["bepusdt_trade_types"] != "usdt.trc20,usdt.erc20" {
		t.Fatalf("trade types = %q", st.settings["bepusdt_trade_types"])
	}
	if st.secrets["bepusdt_api_token"] != "tok123" {
		t.Fatalf("api token not stored in secrets: %q", st.secrets["bepusdt_api_token"])
	}
	if !svc.IsSecretKey("bepusdt_api_token") || svc.IsSecretKey("site_title") {
		t.Fatal("IsSecretKey classification broken")
	}
}

// TestSettingsServiceSavePaymentInvalid 非法法币/URL 应返回错误且不写入。
func TestSettingsServiceSavePaymentInvalid(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SavePayment(map[string]any{"fiat": "not_a_fiat"}); err == nil {
		t.Fatal("invalid fiat should error")
	}
	if err := svc.SavePayment(map[string]any{"bepusdt_base_url": "ftp://x"}); err == nil {
		t.Fatal("invalid url should error")
	}
	if len(st.settings) != 0 {
		t.Fatalf("invalid input must not write anything: %v", st.settings)
	}
}

// TestSettingsServiceSaveHashPay 保存 HashPay 配置：私钥进 secrets，网关切换生效。
func TestSettingsServiceSaveHashPay(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, security.NewCipher("test-secret"), config.Config{})
	if err := svc.SavePayment(map[string]any{
		"payment_gateway":     "hashpay",
		"hashpay_base_url":    "https://pay.hashpay.test/",
		"hashpay_merchant_id": "merchant-1",
		"hashpay_private_key": "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----",
		"hashpay_currency":    "usd",
		"hashpay_notify_path": "/cb/hashpay",
	}); err != nil {
		t.Fatalf("save hashpay: %v", err)
	}
	if svc.GatewayName() != "hashpay" {
		t.Fatalf("gateway = %q, want hashpay", svc.GatewayName())
	}
	if st.settings["hashpay_base_url"] != "https://pay.hashpay.test" {
		t.Fatalf("hashpay base url = %q", st.settings["hashpay_base_url"])
	}
	if st.settings["hashpay_currency"] != "USD" {
		t.Fatalf("hashpay currency = %q", st.settings["hashpay_currency"])
	}
	if st.settings["hashpay_notify_path"] != "/cb/hashpay" {
		t.Fatalf("hashpay notify path = %q", st.settings["hashpay_notify_path"])
	}
	if st.secrets["hashpay_private_key"] == "" {
		t.Fatal("hashpay private key not stored in secrets")
	}
	if !svc.IsSecretKey("hashpay_private_key") {
		t.Fatal("hashpay_private_key must be classified as secret")
	}
	cfg := svc.PaymentConfig()
	if cfg.PaymentGateway != "hashpay" || cfg.HashPayPrivateKey == "" || cfg.HashPayMerchantID != "merchant-1" {
		t.Fatalf("payment config = %+v", cfg)
	}
	// 双网关并存：主网关 hashpay，HashPay 货币独立配置。
	ps := svc.PaymentServiceConfig()
	if ps.HashPayCurrency != "USD" || ps.Gateway != "hashpay" {
		t.Fatalf("payment service config = %+v", ps)
	}
	if len(ps.EnabledGateways) != 1 || ps.EnabledGateways[0] != "hashpay" {
		t.Fatalf("enabled gateways = %v", ps.EnabledGateways)
	}
}

// TestSettingsServiceHashPayPrivateKeyValidation 私钥栏误填公钥/非 PEM 必须报错（防呆）。
func TestSettingsServiceHashPayPrivateKeyValidation(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, security.NewCipher("test-secret"), config.Config{})
	// 公钥被拒，且不写入。
	if err := svc.SavePayment(map[string]any{"hashpay_private_key": "-----BEGIN PUBLIC KEY-----\nMIIB\n-----END PUBLIC KEY-----"}); err == nil {
		t.Fatal("public key must be rejected")
	}
	if _, ok := st.secrets["hashpay_private_key"]; ok {
		t.Fatal("public key must not be stored")
	}
	// 非 PEM 文本被拒。
	if err := svc.SavePayment(map[string]any{"hashpay_private_key": "not-a-key"}); err == nil {
		t.Fatal("garbage key must be rejected")
	}
	// 合法 PKCS#8 私钥可保存。
	if err := svc.SavePayment(map[string]any{"hashpay_private_key": "-----BEGIN PRIVATE KEY-----\nMIIE\n-----END PRIVATE KEY-----"}); err != nil {
		t.Fatalf("valid private key: %v", err)
	}
	if st.secrets["hashpay_private_key"] == "" {
		t.Fatal("valid private key must be stored")
	}
}

// TestSettingsServiceGatewayDefault 未配置时默认 BEpusdt；非法网关值被忽略。
func TestSettingsServiceGatewayDefault(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Load())
	if svc.GatewayName() != "bepusdt" {
		t.Fatalf("default gateway = %q, want bepusdt", svc.GatewayName())
	}
	_ = st.SetSetting("payment_gateway", "stripe")
	if svc.GatewayName() != "bepusdt" {
		t.Fatalf("invalid gateway must fall back, got %q", svc.GatewayName())
	}
	_ = st.SetSetting("payment_gateway", "stripe,hashpay")
	if svc.GatewayName() != "hashpay" {
		t.Fatalf("gateway name = %q, want hashpay", svc.GatewayName())
	}
	if !svc.GatewayEnabled("hashpay") || svc.GatewayEnabled("stripe") {
		t.Fatalf("enabled = %v", svc.EnabledGateways())
	}
	if svc.HashPayNotifyPath() != "/notify/hashpay" {
		t.Fatalf("default hashpay notify path = %q", svc.HashPayNotifyPath())
	}
}

// TestSettingsServiceDualGateway 双网关并存：逗号分隔启用列表保存与读取。
func TestSettingsServiceDualGateway(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, security.NewCipher("test-secret"), config.Load())
	if err := svc.SavePayment(map[string]any{
		"payment_gateway": "bepusdt, hashpay",
	}); err != nil {
		t.Fatalf("save dual gateway: %v", err)
	}
	enabled := svc.EnabledGateways()
	if len(enabled) != 2 || enabled[0] != "bepusdt" || enabled[1] != "hashpay" {
		t.Fatalf("enabled = %v, want [bepusdt hashpay]", enabled)
	}
	if !svc.GatewayEnabled("bepusdt") || !svc.GatewayEnabled("hashpay") {
		t.Fatalf("both gateways must be enabled: %v", enabled)
	}
}

// TestSettingsServiceSaveNotifyWebhookURL 非法 webhook_url 应报错；合法 http(s) 可保存。
func TestSettingsServiceSaveNotifyWebhookURL(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SaveNotify(map[string]any{"webhook_url": "ftp://x"}); err == nil {
		t.Fatal("invalid webhook_url should error")
	}
	if err := svc.SaveNotify(map[string]any{"webhook_url": "https://hooks.example.com/abc"}); err != nil {
		t.Fatalf("valid webhook_url: %v", err)
	}
	if st.settings["webhook_url"] != "https://hooks.example.com/abc" {
		t.Fatalf("webhook_url = %q", st.settings["webhook_url"])
	}
	if err := svc.SaveNotify(map[string]any{"smtp_port": "abc"}); err == nil {
		t.Fatal("invalid smtp_port should error")
	}
	if err := svc.SaveNotify(map[string]any{"smtp_port": "587"}); err != nil {
		t.Fatalf("valid smtp_port: %v", err)
	}
	if st.settings["smtp_port"] != "587" {
		t.Fatalf("smtp_port = %q, want 587", st.settings["smtp_port"])
	}
}
