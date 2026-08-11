package service

import (
	"errors"
	"regexp"
	"sort"
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
	// payment_gateway 为逗号分隔的启用网关列表（如 "bepusdt,hashpay"），
	// 展示顺序按各网关优先级排序（数值越小越靠前），首位作为主网关（订单默认）。
	enabled := s.EnabledGateways()
	cfg.EnabledGateways = enabled
	if len(enabled) > 0 {
		cfg.PaymentGateway = enabled[0]
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
	if v := s.Get("bepusdt_notify_url"); v != "" {
		cfg.NotifyURL = v
	} else if v := s.Get("hashpay_notify_url"); v != "" {
		cfg.NotifyURL = v
	} else if publicOverridden {
		// 主网关回调路径（可配置），避免自定义路径下回调 404
		cfg.NotifyURL = cfg.PublicBaseURL + s.NotifyPath()
	}
	return cfg
}

// PaymentServiceConfig 供 OrderService 读取支付配置。
func (s *SettingsService) PaymentServiceConfig() PaymentConfig {
	cfg := s.PaymentConfig()
	return PaymentConfig{
		PublicBaseURL:    cfg.PublicBaseURL,
		NotifyURL:        cfg.NotifyURL,
		BepusdtNotifyURL: s.notifyURLFor(cfg, "bepusdt"),
		HashPayNotifyURL: s.notifyURLFor(cfg, "hashpay"),
		TimeoutSec:       cfg.BepusdtTimeoutSec,
		Fiat:             cfg.BepusdtFiat,
		HashPayCurrency:  cfg.HashPayCurrency,
		TradeTypes:       cfg.BepusdtTradeTypes,
		EnabledGateways:  cfg.EnabledGateways,
		Gateway:          cfg.PaymentGateway,
	}
}

// notifyURLFor 返回指定网关的有效回调地址（显式配置 > 公开地址 + 网关回调路径）。
func (s *SettingsService) notifyURLFor(cfg config.Config, gateway string) string {
	if gateway == "hashpay" {
		if v := s.Get("hashpay_notify_url"); v != "" {
			return v
		}
		if cfg.PublicBaseURL != "" {
			return cfg.PublicBaseURL + s.HashPayNotifyPath()
		}
		return ""
	}
	if v := s.Get("bepusdt_notify_url"); v != "" {
		return v
	}
	if cfg.PublicBaseURL != "" {
		return cfg.PublicBaseURL + s.NotifyPath()
	}
	return ""
}

// EnabledGateways 返回启用的支付网关列表，按优先级排序（数值越小越靠前；
// -1 最高，0 为常规第一）。未配置优先级时默认 bepusdt=0、hashpay=1。
func (s *SettingsService) EnabledGateways() []string {
	enabled := EnabledGatewaysFrom(s.Get("payment_gateway"))
	sort.SliceStable(enabled, func(i, j int) bool {
		return s.gatewayPriority(enabled[i]) < s.gatewayPriority(enabled[j])
	})
	return enabled
}

// gatewayPriority 返回网关优先级（后台可配置；越小越靠前）。
func (s *SettingsService) gatewayPriority(gateway string) int {
	if gateway == "hashpay" {
		if v := s.Get("gateway_hashpay_priority"); v != "" {
			if n, err := strconv.Atoi(v); err == nil {
				return n
			}
		}
		return 1 // 默认排在 bepusdt 之后
	}
	if v := s.Get("gateway_bepusdt_priority"); v != "" {
		if n, err := strconv.Atoi(v); err == nil {
			return n
		}
	}
	return 0 // 默认 bepusdt 第一
}

// GatewayEnabled 判断指定网关是否启用。
func (s *SettingsService) GatewayEnabled(name string) bool {
	for _, g := range s.EnabledGateways() {
		if g == name {
			return true
		}
	}
	return false
}

// GatewayName 返回主支付网关（启用列表首位，默认 bepusdt）。
func (s *SettingsService) GatewayName() string {
	enabled := s.EnabledGateways()
	if len(enabled) > 0 {
		return enabled[0]
	}
	return "bepusdt"
}

// GatewayDisplayName 返回网关的自定义显示名称（未配置时为空，前端回退默认文案）。
func (s *SettingsService) GatewayDisplayName(gateway string) string {
	if gateway == "hashpay" {
		return s.Get("gateway_hashpay_name")
	}
	return s.Get("gateway_bepusdt_name")
}

// GatewayMeta 返回网关自定义名称与简介（可为空）。
func (s *SettingsService) GatewayMeta(gateway string) (name, description string) {
	if gateway == "hashpay" {
		return s.Get("gateway_hashpay_name"), s.Get("gateway_hashpay_desc")
	}
	return s.Get("gateway_bepusdt_name"), s.Get("gateway_bepusdt_desc")
}

// AllGatewayMeta 返回所有启用网关的自定义名称/简介（供前台渲染支付方式选择）。
func (s *SettingsService) AllGatewayMeta() map[string]map[string]string {
	out := map[string]map[string]string{}
	for _, g := range s.EnabledGateways() {
		name, desc := s.GatewayMeta(g)
		out[g] = map[string]string{"name": name, "description": desc}
	}
	return out
}

// EnabledGatewaysFrom 解析并校验逗号分隔的网关启用列表。
// 非法值忽略；空结果回退 bepusdt（兼容存量/缺省配置）。
func EnabledGatewaysFrom(raw string) []string {
	seen := map[string]bool{}
	var out []string
	for _, v := range strings.Split(raw, ",") {
		v = strings.ToLower(strings.TrimSpace(v))
		if v != "bepusdt" && v != "hashpay" {
			continue
		}
		if seen[v] {
			continue
		}
		seen[v] = true
		out = append(out, v)
	}
	if len(out) == 0 {
		out = append(out, "bepusdt")
	}
	return out
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
	// 网关启用列表（逗号分隔，可多选）；至少保留一个有效网关。
	if v := strings.TrimSpace(str(input["payment_gateway"])); v != "" {
		enabled := EnabledGatewaysFrom(v)
		_ = s.Set("payment_gateway", strings.Join(enabled, ","))
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
		// 防呆：HashPay 商户面板同时展示公钥与私钥，误填公钥会导致下单 502。
		// 这里只认 PKCS#8 / PKCS#1 私钥头，明确提示而不是静默保存。
		if !strings.Contains(v, "-----BEGIN PRIVATE KEY-----") && !strings.Contains(v, "-----BEGIN RSA PRIVATE KEY-----") {
			return errors.New("HashPay 私钥格式错误：请粘贴 -----BEGIN PRIVATE KEY----- 开头的商户私钥（不是公钥）")
		}
		_ = s.SetSecret("hashpay_private_key", v)
	}
	// 网关显示名称 / 简介（前台支付方式选择与订单展示使用，留空回退默认文案）。
	for _, field := range []string{
		"gateway_bepusdt_name", "gateway_bepusdt_desc",
		"gateway_hashpay_name", "gateway_hashpay_desc",
	} {
		if v, ok := input[field]; ok {
			cleaned := strings.TrimSpace(str(v))
			if field == "gateway_bepusdt_name" || field == "gateway_hashpay_name" {
				if len([]rune(cleaned)) > 40 {
					cleaned = string([]rune(cleaned)[:40])
				}
			} else if len([]rune(cleaned)) > 200 {
				cleaned = string([]rune(cleaned)[:200])
			}
			_ = s.Set(field, cleaned)
		}
	}
	// 网关优先级（越小越靠前；-1 最高，0 为常规第一，默认 bepusdt=0 / hashpay=1）。
	for _, field := range []string{"gateway_bepusdt_priority", "gateway_hashpay_priority"} {
		if v, ok := input[field]; ok {
			if n, err := strconv.Atoi(strings.TrimSpace(str(v))); err == nil && n >= -1 && n <= 99 {
				_ = s.Set(field, strconv.Itoa(n))
			}
		}
	}
	return nil
}
