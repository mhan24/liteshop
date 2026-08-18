package application

import (
	models "shop/internal/modules/settings/domain"
	"shop/internal/platform/config"
	"sort"
	"strconv"
	"strings"
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
	if v := s.safeURL("bepusdt_base_url"); v != "" {
		cfg.BepusdtBaseURL = v
	}
	if v := s.GetSecret("bepusdt_api_token"); v != "" {
		cfg.BepusdtToken = v
	}
	if v := s.Get("bepusdt_timeout_sec"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.BepusdtTimeoutSec = n
		}
	}
	if v := s.safeURL("hashpay_base_url"); v != "" {
		cfg.HashPayBaseURL = v
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
	if v := s.safeURL("shop_public_base_url"); v != "" {
		cfg.PublicBaseURL = v
		publicOverridden = true
	}
	if v := s.safeURL("bepusdt_notify_url"); v != "" {
		cfg.NotifyURL = v
	} else if v := s.safeURL("hashpay_notify_url"); v != "" {
		cfg.NotifyURL = v
	} else if publicOverridden {
		// 主网关回调路径（可配置），避免自定义路径下回调 404
		cfg.NotifyURL = cfg.PublicBaseURL + s.NotifyPath()
	}
	return cfg
}

// PaymentServiceConfig 供 OrderService 读取支付配置。
func (s *SettingsService) PaymentServiceConfig() models.PaymentConfig {
	cfg := s.PaymentConfig()
	return models.PaymentConfig{
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
		if v := s.safeURL("hashpay_notify_url"); v != "" {
			return v
		}
		if cfg.PublicBaseURL != "" {
			return cfg.PublicBaseURL + s.HashPayNotifyPath()
		}
		return ""
	}
	if v := s.safeURL("bepusdt_notify_url"); v != "" {
		return v
	}
	if cfg.PublicBaseURL != "" {
		return cfg.PublicBaseURL + s.NotifyPath()
	}
	return ""
}

func (s *SettingsService) safeURL(key string) string {
	v := s.Get(key)
	if v == "" {
		return ""
	}
	normalized, err := normalizeHTTPURL(v, false)
	if err != nil {
		return ""
	}
	return normalized
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
