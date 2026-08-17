package application

import (
	"errors"
	"regexp"
	"strconv"
	"strings"
)

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
func (s *SettingsService) SavePayment(input map[string]any) (err error) {
	var writeErr error
	write := func(key, value string) {
		if writeErr == nil {
			writeErr = s.Set(key, value)
		}
	}
	writeSecret := func(key, value string) {
		if writeErr == nil {
			writeErr = s.SetSecret(key, value)
		}
	}
	set := func(key, field string) {
		if v, ok := input[field]; ok {
			write(key, strings.TrimSpace(str(v)))
		}
	}
	// 网关启用列表（逗号分隔，可多选）；至少保留一个有效网关。
	if v := strings.TrimSpace(str(input["payment_gateway"])); v != "" {
		enabled := EnabledGatewaysFrom(v)
		write("payment_gateway", strings.Join(enabled, ","))
	}
	set("bepusdt_timeout_sec", "bepusdt_timeout_sec")
	if v, ok := input["bepusdt_base_url"]; ok {
		u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
		if err != nil {
			return err
		}
		write("bepusdt_base_url", u)
	}
	if v, ok := input["fiat"]; ok {
		f, err := normalizeFiat(strings.TrimSpace(str(v)))
		if err != nil {
			return err
		}
		// 注意键名为 bepusdt_fiat（读取方），旧代码误写 "fiat" 导致配置不生效。
		write("bepusdt_fiat", f)
	}
	if v, ok := input["trade_types"]; ok {
		tt, err := normalizeTradeTypes(strings.TrimSpace(str(v)))
		if err != nil {
			return err
		}
		write("bepusdt_trade_types", tt)
	}
	for _, field := range []string{"shop_public_base_url", "bepusdt_notify_url"} {
		if v, ok := input[field]; ok {
			u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
			if err != nil {
				return err
			}
			write(field, u)
		}
	}
	// 回调路径需字符校验且不得与已有路由冲突，非法值回退默认（不保存）
	if v := strings.TrimSpace(str(input["bepusdt_notify_path"])); v != "" {
		if !strings.HasPrefix(v, "/") {
			v = "/" + v
		}
		if reNotifyPath.MatchString(v) && !notifyPathConflicts(v) {
			write("bepusdt_notify_path", v)
		}
	}
	if v := strings.TrimSpace(str(input["bepusdt_api_token"])); v != "" {
		writeSecret("bepusdt_api_token", v)
	}
	if v, ok := input["hashpay_base_url"]; ok {
		u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
		if err != nil {
			return err
		}
		write("hashpay_base_url", u)
	}
	set("hashpay_merchant_id", "hashpay_merchant_id")
	if v := strings.ToUpper(strings.TrimSpace(str(input["hashpay_currency"]))); v != "" {
		if _, err := normalizeFiat(v); err == nil {
			write("hashpay_currency", v)
		}
	}
	for _, field := range []string{"hashpay_notify_url"} {
		if v, ok := input[field]; ok {
			u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
			if err != nil {
				return err
			}
			write(field, u)
		}
	}
	if v := strings.TrimSpace(str(input["hashpay_notify_path"])); v != "" {
		if !strings.HasPrefix(v, "/") {
			v = "/" + v
		}
		if reNotifyPath.MatchString(v) && !notifyPathConflicts(v) {
			write("hashpay_notify_path", v)
		}
	}
	if v := strings.TrimSpace(str(input["hashpay_private_key"])); v != "" {
		// 防呆：HashPay 商户面板同时展示公钥与私钥，误填公钥会导致下单 502。
		// 这里只认 PKCS#8 / PKCS#1 私钥头，明确提示而不是静默保存。
		if !strings.Contains(v, "-----BEGIN PRIVATE KEY-----") && !strings.Contains(v, "-----BEGIN RSA PRIVATE KEY-----") {
			return errors.New("HashPay 私钥格式错误：请粘贴 -----BEGIN PRIVATE KEY----- 开头的商户私钥（不是公钥）")
		}
		writeSecret("hashpay_private_key", v)
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
			write(field, cleaned)
		}
	}
	// 网关优先级（越小越靠前；-1 最高，0 为常规第一，默认 bepusdt=0 / hashpay=1）。
	for _, field := range []string{"gateway_bepusdt_priority", "gateway_hashpay_priority"} {
		if v, ok := input[field]; ok {
			if n, err := strconv.Atoi(strings.TrimSpace(str(v))); err == nil && n >= -1 && n <= 99 {
				write(field, strconv.Itoa(n))
			}
		}
	}
	return writeErr
}
