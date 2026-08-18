package application

import (
	"errors"
	"strings"
	"testing"

	"shop/internal/platform/config"
	"shop/internal/platform/security"
)

// stubSettingsStore 内存版 SettingsStore，验证 service 可脱离 SQLite 独立测试。
type stubSettingsStore struct {
	settings  map[string]string
	secrets   map[string]string
	keys      []string
	setErr    error
	secretErr error
}

func newStubSettingsStore() *stubSettingsStore {
	return &stubSettingsStore{
		settings: map[string]string{},
		secrets:  map[string]string{},
		keys:     []string{"bepusdt_api_token", "smtp_password", "telegram_bot_token", "webhook_secret", "turnstile_secret", "maintenance_password", "hashpay_private_key"},
	}
}

func (s *stubSettingsStore) GetSetting(key string) (string, error) { return s.settings[key], nil }
func (s *stubSettingsStore) SetSetting(key, value string) error {
	if s.setErr != nil {
		return s.setErr
	}
	s.settings[key] = value
	return nil
}
func (s *stubSettingsStore) AllSettings() (map[string]string, error) { return s.settings, nil }
func (s *stubSettingsStore) GetSecret(key string, _ *security.Cipher) (string, error) {
	if s.secretErr != nil {
		return "", s.secretErr
	}
	return s.secrets[key], nil
}
func (s *stubSettingsStore) SetSecret(key, value string, _ *security.Cipher) error {
	if s.secretErr != nil {
		return s.secretErr
	}
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
	if err := svc.SavePayment(map[string]any{"payment_gateway": "bepusdt,hashpay"}); err != nil {
		t.Fatalf("enable dual gateways: %v", err)
	}
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
	if err := svc.SavePayment(map[string]any{"bepusdt_base_url": "http://pay.example.com"}); err == nil {
		t.Fatal("public payment URL over HTTP should error")
	}
	if len(st.settings) != 0 {
		t.Fatalf("invalid input must not write anything: %v", st.settings)
	}
	loopback := newStubSettingsStore()
	if err := NewSettingsService(loopback, nil, config.Config{}).SavePayment(map[string]any{"bepusdt_base_url": "http://localhost:8081"}); err != nil {
		t.Fatalf("loopback HTTP payment URL should remain allowed: %v", err)
	}
}

// TestSettingsSavePropagatesStoreErrors 配置落库失败不能被静默吞掉，否则后台会提示保存成功但实际未保存。
func TestSettingsSavePropagatesStoreErrors(t *testing.T) {
	storeErr := errors.New("settings store unavailable")
	st := newStubSettingsStore()
	st.setErr = storeErr
	svc := NewSettingsService(st, security.NewCipher("test-secret"), config.Config{})

	if err := svc.SavePayment(map[string]any{"gateway_bepusdt_name": "USDT"}); !errors.Is(err, storeErr) {
		t.Fatalf("payment save err = %v, want %v", err, storeErr)
	}
	if err := svc.SaveSite(map[string]any{"site_title": "LiteShop"}); !errors.Is(err, storeErr) {
		t.Fatalf("site save err = %v, want %v", err, storeErr)
	}
	if err := svc.SaveNotify(map[string]any{"smtp_host": "smtp.example.com"}); !errors.Is(err, storeErr) {
		t.Fatalf("notify save err = %v, want %v", err, storeErr)
	}

	st.setErr = nil
	st.secretErr = storeErr
	if err := svc.SavePayment(map[string]any{"bepusdt_api_token": "token"}); !errors.Is(err, storeErr) {
		t.Fatalf("payment secret save err = %v, want %v", err, storeErr)
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

// TestSettingsServiceGatewayMeta 网关显示名称/简介自定义保存与读取（空值回退默认）。
func TestSettingsServiceGatewayMeta(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SavePayment(map[string]any{"payment_gateway": "bepusdt,hashpay"}); err != nil {
		t.Fatalf("enable dual gateways: %v", err)
	}
	if err := svc.SavePayment(map[string]any{
		"gateway_bepusdt_name": "USDT 网络",
		"gateway_bepusdt_desc": "TRC20 / ERC20",
		"gateway_hashpay_name": "加密支付",
		"gateway_hashpay_desc": "多链 USDT/USDC",
	}); err != nil {
		t.Fatalf("save meta: %v", err)
	}
	if svc.GatewayDisplayName("bepusdt") != "USDT 网络" || svc.GatewayDisplayName("hashpay") != "加密支付" {
		t.Fatalf("display name mismatch: %q / %q", svc.GatewayDisplayName("bepusdt"), svc.GatewayDisplayName("hashpay"))
	}
	name, desc := svc.GatewayMeta("bepusdt")
	if name != "USDT 网络" || desc != "TRC20 / ERC20" {
		t.Fatalf("bepusdt meta = %q / %q", name, desc)
	}
	meta := svc.AllGatewayMeta()
	if meta["bepusdt"]["name"] != "USDT 网络" || meta["hashpay"]["description"] != "多链 USDT/USDC" {
		t.Fatalf("all meta = %v", meta)
	}
	// 未配置时为空（前端回退默认文案）。
	if svc.GatewayDisplayName("bepusdt") == "" {
		t.Fatal("custom name should be read")
	}
	// 名称超长截断到 40 字符。
	if err := svc.SavePayment(map[string]any{"gateway_hashpay_name": strings.Repeat("长", 60)}); err != nil {
		t.Fatalf("save long name: %v", err)
	}
	if got := svc.GatewayDisplayName("hashpay"); len([]rune(got)) != 40 {
		t.Fatalf("name not truncated: %d runes", len([]rune(got)))
	}
}

// TestSettingsServiceGatewayPriority 网关优先级排序：数值越小越靠前，默认 bepusdt 第一。
func TestSettingsServiceGatewayPriority(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SavePayment(map[string]any{"payment_gateway": "bepusdt,hashpay"}); err != nil {
		t.Fatalf("enable dual gateways: %v", err)
	}
	// 默认：bepusdt=0、hashpay=1 → bepusdt 第一，主网关 bepusdt。
	enabled := svc.EnabledGateways()
	if len(enabled) != 2 || enabled[0] != "bepusdt" || enabled[1] != "hashpay" {
		t.Fatalf("default order = %v, want [bepusdt hashpay]", enabled)
	}
	if svc.GatewayName() != "bepusdt" {
		t.Fatalf("default primary = %q, want bepusdt", svc.GatewayName())
	}
	// HashPay 优先级 -1（最高）→ 排到最前，主网关变为 hashpay。
	if err := svc.SavePayment(map[string]any{"gateway_hashpay_priority": "-1"}); err != nil {
		t.Fatalf("save hashpay priority: %v", err)
	}
	enabled = svc.EnabledGateways()
	if len(enabled) != 2 || enabled[0] != "hashpay" || enabled[1] != "bepusdt" {
		t.Fatalf("priority order = %v, want [hashpay bepusdt]", enabled)
	}
	if svc.GatewayName() != "hashpay" {
		t.Fatalf("primary after priority = %q, want hashpay", svc.GatewayName())
	}
	// 非法优先级（越界）不保存。
	if err := svc.SavePayment(map[string]any{"gateway_bepusdt_priority": "100"}); err != nil {
		t.Fatalf("save invalid priority: %v", err)
	}
	if svc.gatewayPriority("bepusdt") == 100 {
		t.Fatal("out-of-range priority must not be saved")
	}
}

func TestSettingsServiceRejectsDuplicateNotifyPaths(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if err := svc.SavePayment(map[string]any{
		"bepusdt_notify_path": "/notify/hashpay",
	}); err == nil {
		t.Fatal("duplicate payment callback paths must be rejected")
	}
}

func TestPaymentConfigIgnoresLegacyPublicHTTPURLs(t *testing.T) {
	st := newStubSettingsStore()
	st.settings["bepusdt_base_url"] = "http://pay.example.com"
	st.settings["shop_public_base_url"] = "http://shop.example.com"
	svc := NewSettingsService(st, nil, config.Config{
		BepusdtBaseURL: "https://safe-pay.example",
		PublicBaseURL:  "https://safe-shop.example",
	})
	cfg := svc.PaymentConfig()
	if cfg.BepusdtBaseURL != "https://safe-pay.example" || cfg.PublicBaseURL != "https://safe-shop.example" {
		t.Fatalf("unsafe legacy URLs were used: %#v", cfg)
	}
}

func TestTurnstileSecretFailsClosedOnDecryptError(t *testing.T) {
	st := newStubSettingsStore()
	st.secretErr = errors.New("decrypt failed")
	svc := NewSettingsService(st, security.NewCipher("test-secret"), config.Config{TurnstileSecret: ""})
	if svc.TurnstileSecret() == "" {
		t.Fatal("turnstile verification must remain enabled when stored secret cannot be decrypted")
	}
}

func TestRestoreSettingsValidatesURLsAndNotifyPaths(t *testing.T) {
	st := newStubSettingsStore()
	svc := NewSettingsService(st, nil, config.Config{})
	if _, err := svc.RestoreSettings(map[string]string{
		"bepusdt_notify_path": "/notify/hashpay",
	}); err == nil {
		t.Fatal("restore must reject duplicate payment callback paths")
	}
	if _, err := svc.RestoreSettings(map[string]string{
		"shop_public_base_url": "http://public.example.com",
	}); err == nil {
		t.Fatal("restore must reject public HTTP URLs")
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
