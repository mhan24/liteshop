package application

import (
	"encoding/json"
	"strings"
)

// SaveSite 保存站点配置（含图片/维护模式/密钥）。
func (s *SettingsService) SaveSite(input map[string]any) error {
	set := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = s.Set(key, strings.TrimSpace(str(v)))
		}
	}
	for key, field := range map[string]string{
		"site_title": "site_title", "site_subtitle": "site_subtitle", "site_announcement": "site_announcement",
		"seo_description": "seo_description", "seo_keywords": "seo_keywords", "site_contact": "site_contact",
		"site_friend_links": "site_friend_links", "site_copyright": "site_copyright",
		"privacy_policy": "privacy_policy", "terms_of_service": "terms_of_service", "turnstile_site_key": "turnstile_site_key",
		"maintenance_message": "maintenance_message",
		"site_locale":         "site_locale", "site_currency": "site_currency", "site_timezone": "site_timezone",
		"stock_display_mode": "stock_display_mode",
	} {
		set(key, field)
	}
	// 首页默认视图：只允许 grid（图片模式）/ list（列表模式）
	if v, ok := input["home_view_mode"]; ok {
		vm := strings.TrimSpace(str(v))
		if vm != "list" {
			vm = "grid"
		}
		_ = s.Set("home_view_mode", vm)
	}
	// 站点公开地址（订单/通知链接使用）。
	if v, ok := input["shop_public_base_url"]; ok {
		u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
		if err != nil {
			return err
		}
		_ = s.Set("shop_public_base_url", u)
	}
	// 图片类 URL 仅接受 http/https 绝对地址（空值表示使用默认占位图）。
	for _, f := range []string{"default_product_image", "site_logo", "site_favicon"} {
		if v, ok := input[f]; ok {
			u, err := normalizeHTTPURL(strings.TrimSpace(str(v)), false)
			if err != nil {
				return err
			}
			_ = s.Set(f, u)
		}
	}
	if v, ok := input["site_links"]; ok {
		if items, ok := v.([]any); ok {
			clean := []map[string]string{}
			for _, item := range items {
				m, ok := item.(map[string]any)
				if !ok {
					continue
				}
				name := strings.TrimSpace(str(m["name"]))
				if name == "" {
					continue
				}
				category := "link"
				if c := strings.TrimSpace(str(m["category"])); c == "contact" || c == "联系方式" {
					category = "contact"
				}
				clean = append(clean, map[string]string{"name": name, "url": strings.TrimSpace(str(m["url"])), "category": category})
			}
			if len(clean) > 50 {
				clean = clean[:50]
			}
			if raw, err := json.Marshal(clean); err == nil {
				_ = s.Set("site_links", string(raw))
			}
		}
	}
	if _, exists := input["maintenance_enabled"]; exists {
		// 统一归一化为 "1"/""（前端传布尔或字符串都可能）。
		v := strings.TrimSpace(str(input["maintenance_enabled"]))
		if v == "1" || strings.EqualFold(v, "true") {
			v = "1"
		} else {
			v = ""
		}
		_ = s.Set("maintenance_enabled", v)
	}
	if v := strings.TrimSpace(str(input["maintenance_password"])); v != "" {
		// 存储 SHA-256 哈希，不再明文保存。
		_ = s.SetMaintenancePasswordHash(s.HashMaintenancePassword(v))
	}
	if v := strings.TrimSpace(str(input["turnstile_secret"])); v != "" {
		_ = s.SetSecret("turnstile_secret", v)
	}
	return nil
}
