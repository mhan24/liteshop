package service

import (
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"time"

	"shop/internal/config"
	"shop/internal/db/repository"
	"shop/internal/security"
)

// SiteSettings 站点前台可见配置（含默认值）。
type SiteSettings struct {
	Title          string
	Subtitle       string
	Announcement   string
	SEODescription string
	SEOKeywords    string
	Contact        string
	FriendLinks    string
	Copyright      string
	Privacy        string
	Terms          string
	Locale         string
	Currency       string
	Timezone       string
	StockDisplay   string
}

// SettingsService 系统配置/密钥的统一入口（handler 不再直连 settings/secrets 表）。
type SettingsService struct {
	db     *sql.DB
	cipher *security.Cipher
	cfg    config.Config
}

func NewSettingsService(db *sql.DB, cipher *security.Cipher, cfg config.Config) *SettingsService {
	return &SettingsService{db: db, cipher: cipher, cfg: cfg}
}

// Get 读取配置（忽略错误，返回去空格值）。
func (s *SettingsService) Get(key string) string {
	v, err := repository.GetSetting(s.db, key)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// Set 写入配置。
func (s *SettingsService) Set(key, value string) error {
	return repository.SetSetting(s.db, key, value)
}

// SetMany 批量写入配置。
func (s *SettingsService) SetMany(values map[string]string) error {
	for k, v := range values {
		if err := repository.SetSetting(s.db, k, v); err != nil {
			return err
		}
	}
	return nil
}

// All 返回全部配置。
func (s *SettingsService) All() (map[string]string, error) {
	return repository.AllSettings(s.db)
}

// IsSecretKey 是否为敏感配置键（secrets 表键 + 会话主密钥）。
func (s *SettingsService) IsSecretKey(k string) bool {
	if k == "session_secret" {
		return true
	}
	for _, sk := range repository.SecretSettingKeys {
		if k == sk {
			return true
		}
	}
	return false
}

// GetSecret 读取并解密敏感配置。
func (s *SettingsService) GetSecret(key string) string {
	if s.cipher == nil {
		return ""
	}
	v, err := repository.GetSecret(s.db, key, s.cipher)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// SetSecret 加密并写入敏感配置。
func (s *SettingsService) SetSecret(key, value string) error {
	return repository.SetSecret(s.db, key, value, s.cipher)
}

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

// NotifyPath 返回 BEpusdt 回调路径（可配置，默认 /notify/bepusdt）。
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

// SaveNotify 保存通知配置（SMTP / Telegram / Webhook / 事件模板）。
func (s *SettingsService) SaveNotify(input map[string]any) error {
	set := func(key, field string) {
		if v, ok := input[field]; ok {
			_ = s.Set(key, strings.TrimSpace(str(v)))
		}
	}
	set("smtp_host", "smtp_host")
	set("smtp_port", "smtp_port")
	set("smtp_from", "smtp_from")
	set("telegram_chat_id", "telegram_chat_id")
	set("webhook_url", "webhook_url")
	set("notify_events", "notify_events")
	set("notify_admin_email", "notify_admin_email")
	if v := strings.TrimSpace(str(input["smtp_username"])); v != "" {
		_ = s.Set("smtp_username", v)
	}
	if v := strings.TrimSpace(str(input["smtp_password"])); v != "" {
		_ = s.SetSecret("smtp_password", v)
	}
	if v := strings.TrimSpace(str(input["telegram_bot_token"])); v != "" {
		_ = s.SetSecret("telegram_bot_token", v)
	}
	if v := strings.TrimSpace(str(input["webhook_secret"])); v != "" {
		_ = s.SetSecret("webhook_secret", v)
	}
	// 事件模板：evt_tpl_<kind>_<event>（空值回退默认模板）
	if v, ok := input["event_templates"]; ok {
		if m, ok := v.(map[string]any); ok {
			for ev, tpl := range m {
				tm, ok := tpl.(map[string]any)
				if !ok {
					continue
				}
				for _, kind := range []string{"telegram", "mail_subject", "mail_body"} {
					if val, ok := tm[kind]; ok {
						_ = s.Set("evt_tpl_"+kind+"_"+ev, strings.TrimSpace(str(val)))
					}
				}
			}
		}
	}
	return nil
}

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
		_ = s.Set("maintenance_enabled", strings.TrimSpace(str(input["maintenance_enabled"])))
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

// BackupSettings 返回可导出的配置（不含密钥类）。
func (s *SettingsService) BackupSettings() (map[string]string, error) {
	settings, err := s.All()
	if err != nil {
		return nil, err
	}
	for k := range settings {
		if s.IsSecretKey(k) {
			delete(settings, k)
		}
	}
	return settings, nil
}

// RestoreSettings 恢复配置（跳过密钥类与超长值）。返回恢复条数。
func (s *SettingsService) RestoreSettings(settings map[string]string) (int, error) {
	count := 0
	for k, v := range settings {
		if len(k) > 80 || len(v) > 20000 {
			continue
		}
		// 密钥类配置禁止被备份覆盖（恢复后需重新填写）。
		if s.IsSecretKey(k) {
			continue
		}
		if err := s.Set(k, v); err != nil {
			return count, err
		}
		count++
	}
	return count, nil
}

// ResetAll 清空业务数据（恢复/重置用）。
func (s *SettingsService) ResetAll() error {
	return repository.ResetAllTables(s.db)
}

// SetupInput 首次初始化输入。
type SetupInput struct {
	SiteTitle       string
	PublicBaseURL   string
	BepusdtBaseURL  string
	BepusdtAPIToken string
	TradeTypes      string
	Fiat            string
	TurnstileSite   string
	TurnstileSecret string
}

// ApplySetup 写入首次初始化配置（校验 URL/法币/收款类型）。
func (s *SettingsService) ApplySetup(in SetupInput) error {
	settings := map[string]string{
		"site_title":          firstNonEmpty(in.SiteTitle, "LiteShop"),
		"site_copyright":      "© {{year}} {{site_title}}. All rights reserved.",
		"bepusdt_fiat":        "CNY",
		"bepusdt_timeout_sec": "1200",
	}
	if in.Fiat != "" {
		f, err := normalizeFiat(in.Fiat)
		if err != nil {
			return err
		}
		settings["bepusdt_fiat"] = f
	}
	if strings.TrimSpace(in.PublicBaseURL) != "" {
		u, err := normalizeHTTPURL(in.PublicBaseURL, false)
		if err != nil {
			return err
		}
		settings["shop_public_base_url"] = u
	}
	if strings.TrimSpace(in.BepusdtBaseURL) != "" {
		u, err := normalizeHTTPURL(in.BepusdtBaseURL, false)
		if err != nil {
			return err
		}
		settings["bepusdt_base_url"] = u
	}
	if strings.TrimSpace(in.TradeTypes) != "" {
		tt, err := normalizeTradeTypes(in.TradeTypes)
		if err != nil {
			return err
		}
		settings["bepusdt_trade_types"] = tt
	}
	if strings.TrimSpace(in.TurnstileSite) != "" {
		settings["turnstile_site_key"] = strings.TrimSpace(in.TurnstileSite)
	}
	// 敏感配置走 secrets 表（AES-GCM 加密），不能明文写入 settings。
	if token := strings.TrimSpace(in.BepusdtAPIToken); token != "" {
		if err := s.SetSecret("bepusdt_api_token", token); err != nil {
			return err
		}
	}
	if secret := strings.TrimSpace(in.TurnstileSecret); secret != "" {
		if err := s.SetSecret("turnstile_secret", secret); err != nil {
			return err
		}
	}
	return s.SetMany(settings)
}

func firstNonEmpty(vals ...string) string {
	for _, v := range vals {
		if strings.TrimSpace(v) != "" {
			return v
		}
	}
	return ""
}

func str(v any) string {
	switch t := v.(type) {
	case string:
		return t
	case float64:
		return strconv.FormatFloat(t, 'f', -1, 64)
	case bool:
		return strconv.FormatBool(t)
	default:
		return ""
	}
}

func normalizeFiat(v string) (string, error) {
	v = strings.ToUpper(strings.TrimSpace(v))
	if len(v) < 3 || len(v) > 10 {
		return "", errors.New("法币代码长度需为 3-10 位，例如 CNY/USD")
	}
	for _, r := range v {
		if r < 'A' || r > 'Z' {
			return "", errors.New("法币代码只能包含英文字母，例如 CNY/USD")
		}
	}
	return v, nil
}

func validTradeType(v string) bool {
	if !strings.Contains(v, ".") {
		return false
	}
	for i, r := range v {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') || r == '-' || r == '_' || r == '.'
		if !ok {
			return false
		}
		if r == '.' && (i == 0 || i == len(v)-1) {
			return false
		}
	}
	return true
}

func normalizeTradeTypes(v string) (string, error) {
	seen := make(map[string]bool)
	var out []string
	for _, part := range strings.Split(v, ",") {
		p := strings.ToLower(strings.TrimSpace(part))
		if p == "" {
			continue
		}
		if !validTradeType(p) {
			return "", errors.New("无效的收款类型：" + p)
		}
		if !seen[p] {
			seen[p] = true
			out = append(out, p)
		}
	}
	if len(out) == 0 {
		return "", errors.New("至少填写一个收款类型")
	}
	return strings.Join(out, ","), nil
}

func normalizeHTTPURL(v string, required bool) (string, error) {
	v = strings.TrimSpace(v)
	if v == "" {
		if required {
			return "", errors.New("URL 不能为空")
		}
		return "", nil
	}
	u, err := url.Parse(v)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return "", errors.New("URL 必须是 http/https 格式")
	}
	return strings.TrimRight(v, "/"), nil
}
