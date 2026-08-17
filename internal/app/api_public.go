package app

import (
	"encoding/json"
	"io"
	"net/http"
	adminsqlite "shop/internal/modules/admin/repository/sqlite"
	settingsapp "shop/internal/modules/settings/application"
	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	"shop/internal/platform/security"
	"strings"
)

func (s *Server) apiSite(w http.ResponseWriter, r *http.Request) {
	st := s.settings.SiteSettings()
	maintenancePassword := s.settings.MaintenancePassword()
	enabled := s.settings.MaintenanceEnabled()
	if enabled && maintenancePassword != "" && s.maintenanceUnlocked(r, maintenancePassword) {
		enabled = false
	}
	writeJSON(w, 200, map[string]any{
		"title":                 st.Title,
		"subtitle":              st.Subtitle,
		"public_base_url":       s.settings.PaymentConfig().PublicBaseURL,
		"announcement":          st.Announcement,
		"seo_description":       st.SEODescription,
		"seo_keywords":          st.SEOKeywords,
		"links":                 s.settings.SiteLinks(),
		"copyright":             st.Copyright,
		"lang":                  chooseLang(r),
		"locale":                st.Locale,
		"currency":              st.Currency,
		"currency_symbol":       currencySymbol(st.Currency),
		"timezone":              st.Timezone,
		"stock_display_mode":    st.StockDisplay,
		"home_view_mode":        s.settings.HomeViewMode(),
		"default_product_image": s.settings.DefaultProductImage(),
		"turnstile_site_key":    s.settings.TurnstileSiteKey(),
		"logo_url":              s.settings.SiteLogoURL(),
		"favicon_url":           s.settings.SiteFaviconURL(),
		"payment_gateway":       s.settings.GatewayName(),
		"payment_gateways":      s.settings.EnabledGateways(),
		"payment_gateway_meta":  s.settings.AllGatewayMeta(),
		"maintenance": map[string]any{
			"enabled": enabled,
			"message": s.settings.Get("maintenance_message"),
		},
	})
}

// currencySymbol 返回货币符号。

func (s *Server) apiMaintenanceUnlock(w http.ResponseWriter, r *http.Request) {
	var input struct {
		Password string `json:"password"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<16)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	if !s.settings.MaintenanceEnabled() {
		writeJSON(w, 200, map[string]any{"ok": true})
		return
	}
	maintenancePassword := s.settings.MaintenancePassword()
	if maintenancePassword == "" ||
		!hmacEqual(s.settings.HashMaintenancePassword(strings.TrimSpace(input.Password)), s.settings.NormalizeMaintenanceHash(maintenancePassword)) {
		writeError(w, 403, "密码错误")
		return
	}
	// 存量明文在解锁成功后升级为哈希存储。
	if normalized := s.settings.NormalizeMaintenanceHash(maintenancePassword); normalized != maintenancePassword {
		_ = s.settings.SetMaintenancePasswordHash(normalized)
		maintenancePassword = normalized
	}
	secure := requestIsHTTPS(r)
	http.SetCookie(w, &http.Cookie{Name: "maint_unlock", Value: s.maintToken(s.settings.NormalizeMaintenanceHash(maintenancePassword)), Path: "/", MaxAge: 43200, HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode})
	writeJSON(w, 200, map[string]any{"ok": true})
}

func (s *Server) apiPage(w http.ResponseWriter, r *http.Request) {
	st := s.settings.SiteSettings()
	slug := r.PathValue("slug")
	switch slug {
	case "privacy":
		writeJSON(w, 200, map[string]any{"content": st.Privacy})
	case "terms":
		writeJSON(w, 200, map[string]any{"content": st.Terms})
	default:
		writeError(w, http.StatusNotFound, "page not found")
	}
}

func (s *Server) apiSetLang(w http.ResponseWriter, r *http.Request) {
	lang := strings.TrimSpace(r.URL.Query().Get("lang"))
	if lang != "en" && lang != "zh" {
		lang = "zh"
	}
	http.SetCookie(w, &http.Cookie{Name: "lang", Value: lang, Path: "/", MaxAge: 31536000, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	writeJSON(w, 200, map[string]any{"ok": true, "lang": lang})
}

func (s *Server) apiSetupStatus(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, map[string]any{"initialized": s.admin.HasAdmin(), "site_title": s.settings.SiteSettings().Title})
}

func (s *Server) apiSetup(w http.ResponseWriter, r *http.Request) {
	if s.admin.HasAdmin() {
		writeError(w, 400, "already initialized")
		return
	}
	var input struct {
		SiteTitle       string `json:"site_title"`
		Username        string `json:"username"`
		Password        string `json:"password"`
		Confirm         string `json:"confirm"`
		PublicBaseURL   string `json:"public_base_url"`
		BepusdtBaseURL  string `json:"bepusdt_base_url"`
		BepusdtAPIToken string `json:"bepusdt_api_token"`
		TradeTypes      string `json:"trade_types"`
		Fiat            string `json:"fiat"`
		TurnstileSite   string `json:"turnstile_site_key"`
		TurnstileSecret string `json:"turnstile_secret"`
	}
	if err := json.NewDecoder(io.LimitReader(r.Body, 1<<20)).Decode(&input); err != nil {
		writeError(w, 400, "bad json")
		return
	}
	username := strings.TrimSpace(input.Username)
	if username == "" {
		username = "admin"
	}
	if len(username) > 64 {
		writeError(w, 400, "用户名过长")
		return
	}
	if err := security.ValidatePasswordStrength(input.Password); err != nil {
		writeError(w, 400, err.Error())
		return
	}
	if input.Password != input.Confirm {
		writeError(w, 400, "两次密码不一致")
		return
	}
	siteTitle := strings.TrimSpace(input.SiteTitle)
	if siteTitle == "" {
		siteTitle = "LiteShop"
	}
	prepared, err := s.settings.PrepareSetup(settingsapp.SetupInput{
		SiteTitle:       siteTitle,
		PublicBaseURL:   input.PublicBaseURL,
		BepusdtBaseURL:  input.BepusdtBaseURL,
		BepusdtAPIToken: input.BepusdtAPIToken,
		TradeTypes:      input.TradeTypes,
		Fiat:            input.Fiat,
		TurnstileSite:   input.TurnstileSite,
		TurnstileSecret: input.TurnstileSecret,
	})
	if err != nil {
		writeError(w, 400, err.Error())
		return
	}
	tx, err := s.db.Begin()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	defer tx.Rollback()
	inserted, err := adminsqlite.SeedAdminTx(tx, username, input.Password)
	if err != nil {
		writeInternalError(w, err)
		return
	}
	if !inserted {
		writeError(w, 400, "already initialized")
		return
	}
	if err := settingssqlite.ApplySetupTx(tx, prepared.Settings, prepared.Secrets, security.NewCipher(s.sessionKey)); err != nil {
		writeInternalError(w, err)
		return
	}
	if err := tx.Commit(); err != nil {
		writeInternalError(w, err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// apiAdminVersion 返回当前版本并异步检查 GitHub 最新 release。
