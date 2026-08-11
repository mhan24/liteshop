package service

import (
	"regexp"
	"strconv"
	"strings"

	"shop/internal/config"
)

func (s *SettingsService) TurnstileSecret() string {
	if v := s.GetSecret("turnstile_secret"); v != "" {
		return v
	}
	return s.cfg.TurnstileSecret
}

func (s *SettingsService) TurnstileSiteKey() string {
	if v := s.Get("turnstile_site_key"); v != "" {
		return v
	}
	return s.cfg.TurnstileSiteKey
}

// PaymentConfig 合并数据库配置与启动默认值，返回完整支付配置。
func (s *SettingsService) PaymentConfig() config.Config {
	cfg := s.cfg
	if v := strings.ToLower(strings.TrimSpace(s.Get("payment_gateway"))); v == "bepusdt" || v == "hashpay" {
		cfg.PaymentGateway = v
	}
	cfg.BepusdtFiat = s.Fiat()
	cfg.BepusdtTradeTypes = s.TradeTypes()
	if len(cfg.BepusdtTradeTypes) > 0 {
		cfg.BepusdtTradeType = cfg.BepusdtTradeTypes[0]
	}
	if v := s.Get("bepusdt_base_url"); v != "" {
		cfg.BepusdtBaseURL = strings.TrimRight(v, "/")
	}
	if v := s.GetSecret("bepusdt_api_token"); v != "" {
		cfg.BepusdtToken = v
	}
	if v := s.Get("bepusdt_timeout_sec"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.BepusdtTimeoutSec = n
		}
	}
	if v := s.Get("hashpay_base_url"); v != "" {
		cfg.HashPayBaseURL = strings.TrimRight(v, "/")
	}
	if v := s.Get("hashpay_merchant_id"); v != "" {
		cfg.HashPayMerchantID = v
	}
	if v := s.GetSecret("hashpay_private_key"); v != "" {
		cfg.HashPayPrivateKey = v
	}
	if v := strings.ToUpper(strings.TrimSpace(s.Get("hashpay_currency"))); v != "" {
		cfg.HashPayCurrency = v
	}
	publicOverridden := false
	if v := s.Get("shop_public_base_url"); v != "" {
		cfg.PublicBaseURL = strings.TrimRight(v, "/")
		publicOverridden = true
	}
	if v := s.Get("bepusdt_notify_url"); v != "" && cfg.PaymentGateway == "bepusdt" {
		cfg.NotifyURL = v
	} else if v := s.Get("hashpay_notify_url"); v != "" && cfg.PaymentGateway == "hashpay" {
		cfg.NotifyURL = v
	} else if publicOverridden {
		// 使用当前网关回调路径（可配置），避免自定义路径下回调 404
		notifyPath := s.NotifyPath()
		if cfg.PaymentGateway == "hashpay" {
			notifyPath = s.HashPayNotifyPath()
		}
		cfg.NotifyURL = cfg.PublicBaseURL + notifyPath
	}
	return cfg
}

// PaymentServiceConfig 供 OrderService 读取支付配置。
func (s *SettingsService) PaymentServiceConfig() PaymentConfig {
	cfg := s.PaymentConfig()
	fiat := cfg.BepusdtFiat
	if cfg.PaymentGateway == "hashpay" && cfg.HashPayCurrency != "" {
		fiat = cfg.HashPayCurrency
	}
	return PaymentConfig{
		PublicBaseURL: cfg.PublicBaseURL,
		NotifyURL:     cfg.NotifyURL,
		TimeoutSec:    cfg.BepusdtTimeoutSec,
		Fiat:          fiat,
		TradeTypes:    cfg.BepusdtTradeTypes,
		Gateway:       cfg.PaymentGateway,
	}
}

// GatewayName 返回当前启用的支付网关（bepusdt / hashpay）。
func (s *SettingsService) GatewayName() string {
	cfg := s.PaymentConfig()
	return cfg.PaymentGateway
}

// Fiat 返回收款法币（兼容旧版本误存到 "fiat" 键的配置）。
func (s *SettingsService) Fiat() string {
	if v := strings.ToUpper(strings.TrimSpace(s.Get("bepusdt_fiat"))); v != "" {
		return v
	}
	if legacy := strings.ToUpper(strings.TrimSpace(s.Get("fiat"))); legacy != "" {
		return legacy
	}
	return s.cfg.BepusdtFiat
}

// TradeTypes 返回启用中的收款类型列表。
func (s *SettingsService) TradeTypes() []string {
	raw := strings.TrimSpace(s.Get("bepusdt_trade_types"))
	var out []string
	// 过滤历史遗留的非法值（旧版本可绕过校验保存），避免前台选项与接口校验不一致。
	for _, p := range strings.Split(raw, ",") {
		p = strings.ToLower(strings.TrimSpace(p))
		if validTradeType(p) {
			out = append(out, p)
		}
	}
	if len(out) > 0 {
		return out
	}
	return s.cfg.BepusdtTradeTypes
}

// TradeTypeAllowed 判断收款类型是否启用。
func (s *SettingsService) TradeTypeAllowed(v string) bool {
	for _, t := range s.TradeTypes() {
		if t == v {
			return true
		}
	}
	return false
}

var reNotifyPath = regexp.MustCompile(`^/[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$`)

// notifyPathConflicts 拒绝与已注册路由冲突的路径（避免 ServeMux 注册 panic）。
func notifyPathConflicts(v string) bool {
	return v == "/health" || v == "/docs" || v == "/setup" ||
		strings.HasPrefix(v, "/api") || strings.HasPrefix(v, "/admin")
}

// NotifyPath 返回支付回调路径（可配置，默认 /notify/bepusdt）。
func (s *SettingsService) NotifyPath() string {
	if v := strings.TrimSpace(s.Get("bepusdt_notify_path")); v != "" {
		if !strings.HasPrefix(v, "/") {
			v = "/" + v
		}
		if reNotifyPath.MatchString(v) && !notifyPathConflicts(v) {
			return v
		}
	}
	return "/notify/bepusdt"
}

// HashPayNotifyPath 返回 HashPay 回调路径（可配置，默认 /notify/hashpay）。
func (s *SettingsService) HashPayNotifyPath() string {
	if v := strings.TrimSpace(s.Get("hashpay_notify_path")); v != "" {
		if !strings.HasPrefix(v, "/") {
			v = "/" + v
		}
		if reNotifyPath.MatchString(v) && !notifyPathConflicts(v) {
			return v
		}
	}
	return "/notify/hashpay"
}

// SavePayment 保存支付配置（网关选择 + BEpusdt / HashPay 各自配置）。
func (s *SettingsService) SavePayment(input map[string]any) error {
	set := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = s.Set(key, strings.TrimSpace(str(v)))
		}
	}
	if v := strings.ToLower(strings.TrimSpace(str(input["payment_gateway"]))); v == "bepusdt" || v == "hashpay" {
		_ = s.Set("payment_gateway", v)
	}
	set("bepusdt_timeout_sec", "bepusdt_timeout_sec")
	if v, ok := input["bepusdt_base_url"]; ok {
		u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
		if err != nil {
			return err
		}
		_ = s.Set("bepusdt_base_url", u)
	}
	if v, ok := input["fiat"]; ok {
		f, err := normalizeFiat(strings.TrimSpace(str(v)))
		if err != nil {
			return err
		}
		// 注意键名为 bepusdt_fiat（读取方），旧代码误写 "fiat" 导致配置不生效。
		_ = s.Set("bepusdt_fiat", f)
	}
	if v, ok := input["trade_types"]; ok {
		tt, err := normalizeTradeTypes(strings.TrimSpace(str(v)))
		if err != nil {
			return err
		}
		_ = s.Set("bepusdt_trade_types", tt)
	}
	for _, field := range []string{"shop_public_base_url", "bepusdt_notify_url"} {
		if v, ok := input[field]; ok {
			u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
			if err != nil {
				return err
			}
			_ = s.Set(field, u)
		}
	}
	// 回调路径需字符校验且不得与已有路由冲突，非法值回退默认（不保存）
	if v := strings.TrimSpace(str(input["bepusdt_notify_path"])); v != "" {
		if !strings.HasPrefix(v, "/") {
			v = "/" + v
		}
		if reNotifyPath.MatchString(v) && !notifyPathConflicts(v) {
			_ = s.Set("bepusdt_notify_path", v)
		}
	}
	if v := strings.TrimSpace(str(input["bepusdt_api_token"])); v != "" {
		_ = s.SetSecret("bepusdt_api_token", v)
	}
	if v, ok := input["hashpay_base_url"]; ok {
		u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
		if err != nil {
			return err
		}
		_ = s.Set("hashpay_base_url", u)
	}
	set("hashpay_merchant_id", "hashpay_merchant_id")
	if v := strings.ToUpper(strings.TrimSpace(str(input["hashpay_currency"]))); v != "" {
		if _, err := normalizeFiat(v); err == nil {
			_ = s.Set("hashpay_currency", v)
		}
	}
	for _, field := range []string{"hashpay_notify_url"} {
		if v, ok := input[field]; ok {
			u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
			if err != nil {
				return err
			}
			_ = s.Set(field, u)
		}
	}
	if v := strings.TrimSpace(str(input["hashpay_notify_path"])); v != "" {
		if !strings.HasPrefix(v, "/") {
			v = "/" + v
		}
		if reNotifyPath.MatchString(v) && !notifyPathConflicts(v) {
			_ = s.Set("hashpay_notify_path", v)
		}
	}
	if v := strings.TrimSpace(str(input["hashpay_private_key"])); v != "" {
		_ = s.SetSecret("hashpay_private_key", v)
	}
	return nil
}
