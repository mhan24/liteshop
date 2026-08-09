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
	publicOverridden := false
	if v := s.Get("shop_public_base_url"); v != "" {
		cfg.PublicBaseURL = strings.TrimRight(v, "/")
		publicOverridden = true
	}
	if v := s.Get("bepusdt_notify_url"); v != "" {
		cfg.NotifyURL = v
	} else if publicOverridden {
		// 使用同一回调路径（可配置），避免自定义路径下回调 404
		cfg.NotifyURL = cfg.PublicBaseURL + s.NotifyPath()
	}
	return cfg
}

// PaymentServiceConfig 供 OrderService 读取支付配置。
func (s *SettingsService) PaymentServiceConfig() PaymentConfig {
	cfg := s.PaymentConfig()
	return PaymentConfig{
		PublicBaseURL: cfg.PublicBaseURL,
		NotifyURL:     cfg.NotifyURL,
		TimeoutSec:    cfg.BepusdtTimeoutSec,
		Fiat:          cfg.BepusdtFiat,
		TradeTypes:    cfg.BepusdtTradeTypes,
	}
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

// SavePayment 保存支付配置（BEpusdt）。
func (s *SettingsService) SavePayment(input map[string]any) error {
	set := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = s.Set(key, strings.TrimSpace(str(v)))
		}
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
	return nil
}
