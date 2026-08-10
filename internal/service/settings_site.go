package service

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"strconv"
	"strings"
	"time"
)

// SiteSettings 返回站点前台配置（含默认值，版权已渲染）。
func (s *SettingsService) SiteSettings() SiteSettings {
	st := SiteSettings{
		Title:        "LiteShop",
		Subtitle:     "选择商品下单，使用加密货币完成支付，支付成功后自动发放卡密。",
		SEOKeywords:  "自动发卡,发卡系统,USDT,数字货币支付",
		Privacy:      "请在这里填写隐私政策。",
		Terms:        "请在这里填写服务条款。",
		Locale:       "zh-CN",
		Currency:     "CNY",
		Timezone:     "Asia/Shanghai",
		StockDisplay: "exact",
	}
	if v := s.Get("site_title"); v != "" {
		st.Title = v
	}
	if v := s.Get("site_subtitle"); v != "" {
		st.Subtitle = v
	}
	st.Announcement = s.Get("site_announcement")
	if v := s.Get("seo_description"); v != "" {
		st.SEODescription = v
	}
	if st.SEODescription == "" {
		st.SEODescription = st.Subtitle
	}
	if v := s.Get("seo_keywords"); v != "" {
		st.SEOKeywords = v
	}
	st.Contact = s.Get("site_contact")
	st.FriendLinks = s.Get("site_friend_links")
	st.Copyright = s.Get("site_copyright")
	if v := s.Get("privacy_policy"); v != "" {
		st.Privacy = v
	}
	if v := s.Get("terms_of_service"); v != "" {
		st.Terms = v
	}
	if st.Copyright == "" {
		st.Copyright = "© {{year}} {{site_title}}. All rights reserved."
	}
	st.Copyright = s.RenderSiteVars(st.Copyright, st.Title)
	st.Locale = firstNonEmpty(s.Get("site_locale"), st.Locale)
	st.Currency = firstNonEmpty(s.Get("site_currency"), st.Currency)
	st.Timezone = firstNonEmpty(s.Get("site_timezone"), st.Timezone)
	st.StockDisplay = firstNonEmpty(s.Get("stock_display_mode"), st.StockDisplay)
	return st
}

// RenderSiteVars 替换版权模板中的 {{site_title}} / {{year}}。
func (s *SettingsService) RenderSiteVars(text, siteTitle string) string {
	text = strings.ReplaceAll(text, "{{site_title}}", siteTitle)
	return strings.ReplaceAll(text, "{{year}}", strconv.Itoa(time.Now().Year()))
}

// SiteLinks 返回解析后的站外链接列表。
func (s *SettingsService) SiteLinks() []map[string]string {
	var arr []map[string]string
	if err := json.Unmarshal([]byte(s.Get("site_links")), &arr); err != nil {
		return []map[string]string{}
	}
	return arr
}

func (s *SettingsService) DefaultProductImage() string {
	return strings.TrimSpace(s.Get("default_product_image"))
}
func (s *SettingsService) SiteLogoURL() string    { return strings.TrimSpace(s.Get("site_logo")) }
func (s *SettingsService) SiteFaviconURL() string { return strings.TrimSpace(s.Get("site_favicon")) }

// HomeViewMode 首页默认视图模式：grid（图片模式）/ list（列表模式），默认图片模式。
func (s *SettingsService) HomeViewMode() string {
	if strings.TrimSpace(s.Get("home_view_mode")) == "list" {
		return "list"
	}
	return "grid"
}

// LowStockThreshold 低库存告警阈值（可用卡密数量）。
func (s *SettingsService) LowStockThreshold() int {
	n, err := strconv.Atoi(s.Get("low_stock_threshold"))
	if err != nil || n <= 0 {
		return 10
	}
	return n
}

func (s *SettingsService) MaintenanceEnabled() bool {
	return s.Get("maintenance_enabled") == "1"
}

func (s *SettingsService) MaintenancePassword() string { return s.GetSecret("maintenance_password") }
func (s *SettingsService) MaintenancePassSet() bool    { return s.MaintenancePassword() != "" }

// HashMaintenancePassword 返回维护密码的 SHA-256 十六进制哈希（用于存储）。
func (s *SettingsService) HashMaintenancePassword(pw string) string {
	sum := sha256.Sum256([]byte(pw))
	return hex.EncodeToString(sum[:])
}

// NormalizeMaintenanceHash 兼容存量明文：已是 64 位十六进制则原样返回，否则视为明文转哈希。
func (s *SettingsService) NormalizeMaintenanceHash(v string) string {
	v = strings.TrimSpace(v)
	if len(v) == 64 {
		if _, err := hex.DecodeString(v); err == nil {
			return strings.ToLower(v)
		}
	}
	return s.HashMaintenancePassword(v)
}

// SetMaintenancePasswordHash 写入维护密码哈希（哈希由调用方计算）。
func (s *SettingsService) SetMaintenancePasswordHash(hash string) error {
	return s.SetSecret("maintenance_password", hash)
}
