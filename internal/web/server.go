package web

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html/template"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"time"

	"shop/internal/bepusdt"
	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/models"
	"shop/internal/notify"
	"shop/internal/order"
)

type Server struct {
	mux       *http.ServeMux
	db        *sql.DB
	cfg       config.Config
	tpl       *template.Template
	pay       *bepusdt.Client
	notifier  *notify.Notifier
	orders    *order.Service
	dbPath    string
	startTime time.Time

	sessMu   sync.Mutex
	sessions map[string]sessionInfo
}

type sessionInfo struct {
	AdminID int64
	Expiry  time.Time
}

type ProductView struct {
	Product   models.Product
	Available int
	Reserved  int
	Sold      int
}

type CategoryView struct {
	Name       string
	DefaultKey string
	Products   []ProductView
}

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
}

type FooterLink struct {
	Name string
	URL  string
}

func NewHandler(cfg config.Config, db *sql.DB) (http.Handler, error) {
	tpl, err := loadTemplates()
	if err != nil {
		return nil, err
	}
	s := &Server{
		db:        db,
		cfg:       cfg,
		tpl:       tpl,
		pay:       bepusdt.New(cfg.BepusdtBaseURL, cfg.BepusdtToken),
		notifier:  notify.New(cfg, db),
		dbPath:    cfg.DatabasePath,
		startTime: time.Now(),
		sessions:  make(map[string]sessionInfo),
	}
	s.orders = order.NewService(
		order.NewRepository(db),
		s.payClient,
		s.paymentConfigForService,
	)
	s.orders.SendPaid = s.notifier.SendPaid
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST /notify/bepusdt", s.handleBepusdtNotify)
	s.registerAPI(mux)
	s.registerDocs(mux)
	mux.Handle("GET /admin/assets/", http.StripPrefix("/admin", http.FileServer(adminAssetsFS())))
	mux.HandleFunc("GET /admin", s.adminIndex)
	mux.HandleFunc("GET /admin/{path...}", s.adminIndex)
	s.mux = mux
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
	s.mux.ServeHTTP(w, r)
}

func (s *Server) render(w http.ResponseWriter, r *http.Request, status int, name string, data any) {
	if m, ok := data.(map[string]any); ok {
		if _, exists := m["Lang"]; !exists {
			m["Lang"] = chooseLang(r)
		}
	}
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.WriteHeader(status)
	if err := s.tpl.ExecuteTemplate(w, name, data); err != nil {
		log.Printf("render %s: %v", name, err)
	}
}

func pathID(r *http.Request, name string) (int64, error) {
	return strconv.ParseInt(r.PathValue(name), 10, 64)
}

func (s *Server) tradeTypeAllowed(v string) bool {
	for _, t := range s.tradeTypes() {
		if v == t {
			return true
		}
	}
	return false
}

func (s *Server) tradeTypes() []string {
	value, err := db.GetSetting(s.db, "bepusdt_trade_types")
	if err == nil && strings.TrimSpace(value) != "" {
		return config.ParseTradeTypes(value)
	}
	return s.cfg.BepusdtTradeTypes
}

func (s *Server) fiat() string {
	value, err := db.GetSetting(s.db, "bepusdt_fiat")
	if err == nil && strings.TrimSpace(value) != "" {
		return strings.ToUpper(strings.TrimSpace(value))
	}
	return s.cfg.BepusdtFiat
}

func (s *Server) paymentConfig() config.Config {
	cfg := s.cfg
	get := func(key string) string {
		v, err := db.GetSetting(s.db, key)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(v)
	}
	cfg.BepusdtFiat = s.fiat()
	cfg.BepusdtTradeTypes = s.tradeTypes()
	if len(cfg.BepusdtTradeTypes) > 0 {
		cfg.BepusdtTradeType = cfg.BepusdtTradeTypes[0]
	}
	if v := get("bepusdt_base_url"); v != "" {
		cfg.BepusdtBaseURL = strings.TrimRight(v, "/")
	}
	if v := get("bepusdt_api_token"); v != "" {
		cfg.BepusdtToken = v
	}
	if v := get("bepusdt_timeout_sec"); v != "" {
		if n, err := strconv.Atoi(v); err == nil && n > 0 {
			cfg.BepusdtTimeoutSec = n
		}
	}
	publicOverridden := false
	if v := get("shop_public_base_url"); v != "" {
		cfg.PublicBaseURL = strings.TrimRight(v, "/")
		publicOverridden = true
	}
	if v := get("bepusdt_notify_url"); v != "" {
		cfg.NotifyURL = v
	} else if publicOverridden {
		cfg.NotifyURL = cfg.PublicBaseURL + "/notify/bepusdt"
	}
	return cfg
}

func (s *Server) payClient() *bepusdt.Client {
	cfg := s.paymentConfig()
	return bepusdt.New(cfg.BepusdtBaseURL, cfg.BepusdtToken)
}

// paymentConfigForService 供 order.Service 读取支付配置。
func (s *Server) paymentConfigForService() order.PaymentConfig {
	cfg := s.paymentConfig()
	return order.PaymentConfig{
		PublicBaseURL: cfg.PublicBaseURL,
		NotifyURL:     cfg.NotifyURL,
		TimeoutSec:    cfg.BepusdtTimeoutSec,
		Fiat:          cfg.BepusdtFiat,
		TradeTypes:    cfg.BepusdtTradeTypes,
	}
}

func (s *Server) siteSettings() SiteSettings {
	st := SiteSettings{
		Title:          "LiteShop",
		Subtitle:       "选择商品下单，使用加密货币完成支付，支付成功后自动发放卡密。",
		Announcement:   "",
		SEODescription: "",
		SEOKeywords:    "自动发卡,发卡系统,USDT,数字货币支付",
		Contact:        "",
		FriendLinks:    "",
		Copyright:      "",
		Privacy:        "请在这里填写隐私政策。",
		Terms:          "请在这里填写服务条款。",
	}
	get := func(key string) string {
		v, err := db.GetSetting(s.db, key)
		if err != nil {
			return ""
		}
		return strings.TrimSpace(v)
	}
	if v := get("site_title"); v != "" {
		st.Title = v
	}
	if v := get("site_subtitle"); v != "" {
		st.Subtitle = v
	}
	st.Announcement = get("site_announcement")
	if v := get("seo_description"); v != "" {
		st.SEODescription = v
	}
	if st.SEODescription == "" {
		st.SEODescription = st.Subtitle
	}
	if v := get("seo_keywords"); v != "" {
		st.SEOKeywords = v
	}
	st.Contact = get("site_contact")
	st.FriendLinks = get("site_friend_links")
	st.Copyright = get("site_copyright")
	if v := get("privacy_policy"); v != "" {
		st.Privacy = v
	}
	if v := get("terms_of_service"); v != "" {
		st.Terms = v
	}
	if st.Copyright == "" {
		st.Copyright = "© {{year}} {{site_title}}. All rights reserved."
	}
	st.Copyright = renderSiteVars(st.Copyright, st.Title)
	st.Locale = firstNonEmpty(get("site_locale"), "zh-CN")
	st.Currency = firstNonEmpty(get("site_currency"), "CNY")
	st.Timezone = firstNonEmpty(get("site_timezone"), "Asia/Shanghai")
	return st
}

func (s *Server) publicData(r *http.Request, title string) map[string]any {
	st := s.siteSettings()
	return map[string]any{
		"Title":          title,
		"Lang":           chooseLang(r),
		"SiteTitle":      st.Title,
		"SiteSubtitle":   st.Subtitle,
		"Announcement":   st.Announcement,
		"SEODescription": st.SEODescription,
		"SEOKeywords":    st.SEOKeywords,
		"SiteContact":    st.Contact,
		"FriendLinks":    parseFriendLinks(st.FriendLinks),
		"SiteCopyright":  st.Copyright,
		"RepoURL":        "https://github.com/mhan24/liteshop",
		"Canonical":      strings.TrimRight(s.paymentConfig().PublicBaseURL, "/") + r.URL.Path,
		"Robots":         "index,follow",
		"NoIndex":        false,
	}
}

func friendLinkURL(line string) string {
	switch {
	case strings.HasPrefix(line, "http://"), strings.HasPrefix(line, "https://"):
		return line
	case strings.HasPrefix(line, "www."):
		return "https://" + line
	case strings.HasPrefix(line, "@"):
		return "https://t.me/" + strings.TrimPrefix(line, "@")
	case strings.Contains(line, "@"):
		return "mailto:" + line
	}
	return ""
}

func friendLinkName(line, url string) string {
	if url == "" {
		return line
	}
	name := strings.TrimPrefix(line, "https://")
	name = strings.TrimPrefix(name, "http://")
	name = strings.TrimPrefix(name, "www.")
	name = strings.TrimPrefix(name, "mailto:")
	name = strings.TrimPrefix(name, "https://t.me/")
	if i := strings.Index(name, "/"); i > 0 {
		name = name[:i]
	}
	if name == "" {
		return line
	}
	return name
}

func parseFriendLinks(raw string) []FooterLink {
	var out []FooterLink
	for _, line := range strings.Split(raw, "\n") {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		name, url, hasSep := strings.Cut(line, "|")
		name = strings.TrimSpace(name)
		url = strings.TrimSpace(url)
		if !hasSep {
			url = friendLinkURL(line)
			name = ""
		}
		if name == "" {
			name = friendLinkName(line, url)
		}
		if name == "" {
			continue
		}
		out = append(out, FooterLink{Name: name, URL: url})
		if len(out) >= 30 {
			break
		}
	}
	return out
}

func (s *Server) handleLang(w http.ResponseWriter, r *http.Request) {
	lang := strings.TrimSpace(r.URL.Query().Get("lang"))
	if lang != "en" && lang != "zh" {
		lang = "zh"
	}
	http.SetCookie(w, &http.Cookie{Name: "lang", Value: lang, Path: "/", MaxAge: 31536000, HttpOnly: true, SameSite: http.SameSiteLaxMode})
	target := "/"
	if ref := strings.TrimSpace(r.Referer()); ref != "" {
		if u, err := url.Parse(ref); err == nil && u.Host == r.Host {
			target = u.RequestURI()
		}
	}
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func (s *Server) handlePrivacy(w http.ResponseWriter, r *http.Request) {
	st := s.siteSettings()
	data := s.publicData(r, tr(chooseLang(r), "privacy"))
	data["PageTitle"] = "隐私政策"
	data["PageContent"] = st.Privacy
	s.render(w, r, 200, "public_page", data)
}

func (s *Server) handleTerms(w http.ResponseWriter, r *http.Request) {
	st := s.siteSettings()
	data := s.publicData(r, tr(chooseLang(r), "terms"))
	data["PageTitle"] = "服务条款"
	data["PageContent"] = st.Terms
	s.render(w, r, 200, "public_page", data)
}

func renderSiteVars(text, siteTitle string) string {
	text = strings.ReplaceAll(text, "{{site_title}}", siteTitle)
	text = strings.ReplaceAll(text, "{{year}}", fmt.Sprintf("%d", time.Now().Year()))
	return text
}

func truncateString(v string, n int) string {
	v = strings.TrimSpace(v)
	r := []rune(v)
	if len(r) <= n {
		return v
	}
	return string(r[:n]) + "…"
}

func (s *Server) handleAdminSite(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		st := s.siteSettings()
		rawCopyright, _ := db.GetSetting(s.db, "site_copyright")
		if strings.TrimSpace(rawCopyright) == "" {
			rawCopyright = "© {{year}} {{site_title}}. All rights reserved."
		}
		s.render(w, r, 200, "admin_site", map[string]any{
			"Title":              "站点设置",
			"SiteTitle":          st.Title,
			"SiteSubtitle":       st.Subtitle,
			"Announcement":       st.Announcement,
			"SEODescription":     st.SEODescription,
			"SEOKeywords":        st.SEOKeywords,
			"SiteContact":        st.Contact,
			"FriendLinks":        st.FriendLinks,
			"SiteCopyright":      rawCopyright,
			"Privacy":            st.Privacy,
			"Terms":              st.Terms,
			"TurnstileSiteKey":   s.turnstileSiteKey(),
			"TurnstileSecretSet": s.turnstileSecret() != "",
			"Saved":              r.URL.Query().Get("saved") == "1",
		})
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	values := map[string]string{
		"site_title":         strings.TrimSpace(r.FormValue("site_title")),
		"site_subtitle":      strings.TrimSpace(r.FormValue("site_subtitle")),
		"site_announcement":  strings.TrimSpace(r.FormValue("site_announcement")),
		"seo_description":    strings.TrimSpace(r.FormValue("seo_description")),
		"seo_keywords":       strings.TrimSpace(r.FormValue("seo_keywords")),
		"site_contact":       strings.TrimSpace(r.FormValue("site_contact")),
		"site_friend_links":  strings.TrimSpace(r.FormValue("site_friend_links")),
		"site_copyright":     strings.TrimSpace(r.FormValue("site_copyright")),
		"privacy_policy":     strings.TrimSpace(r.FormValue("privacy_policy")),
		"terms_of_service":   strings.TrimSpace(r.FormValue("terms_of_service")),
		"turnstile_site_key": strings.TrimSpace(r.FormValue("turnstile_site_key")),
	}
	if v := strings.TrimSpace(r.FormValue("turnstile_secret")); v != "" {
		values["turnstile_secret"] = v
	}
	if len([]rune(values["site_title"])) > 80 || len([]rune(values["site_subtitle"])) > 160 || len([]rune(values["seo_description"])) > 220 || len([]rune(values["seo_keywords"])) > 220 || len([]rune(values["site_announcement"])) > 4000 || len([]rune(values["site_contact"])) > 1000 || len([]rune(values["site_friend_links"])) > 3000 || len([]rune(values["site_copyright"])) > 200 || len([]rune(values["privacy_policy"])) > 12000 || len([]rune(values["terms_of_service"])) > 12000 || len([]rune(values["turnstile_site_key"])) > 128 || len([]rune(values["turnstile_secret"])) > 128 {
		s.render(w, r, 400, "admin_site", map[string]any{"Title": "site", "SiteTitle": values["site_title"], "SiteSubtitle": values["site_subtitle"], "Announcement": values["site_announcement"], "SEODescription": values["seo_description"], "SEOKeywords": values["seo_keywords"], "SiteContact": values["site_contact"], "FriendLinks": values["site_friend_links"], "SiteCopyright": values["site_copyright"], "Privacy": values["privacy_policy"], "Terms": values["terms_of_service"], "TurnstileSiteKey": values["turnstile_site_key"], "TurnstileSecretSet": values["turnstile_secret"] != "", "Error": tr(chooseLang(r), "field_too_long")})
		return
	}
	for key, value := range values {
		if err := db.SetSetting(s.db, key, value); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	http.Redirect(w, r, "/admin/site?saved=1", http.StatusSeeOther)
}

func (s *Server) handleAdminSettings(w http.ResponseWriter, r *http.Request) {
	data := func(cfg config.Config, fiat, tradeTypes string, saved bool, errMsg string) map[string]any {
		return map[string]any{
			"Title":           "支付设置",
			"Fiat":            fiat,
			"TradeTypes":      tradeTypes,
			"BepusdtBaseURL":  cfg.BepusdtBaseURL,
			"BepusdtTokenSet": cfg.BepusdtToken != "",
			"PublicBaseURL":   cfg.PublicBaseURL,
			"NotifyURL":       cfg.NotifyURL,
			"TimeoutSec":      cfg.BepusdtTimeoutSec,
			"Saved":           saved,
			"Error":           errMsg,
		}
	}
	if r.Method == http.MethodGet {
		cfg := s.paymentConfig()
		s.render(w, r, 200, "admin_settings", data(cfg, s.fiat(), strings.Join(s.tradeTypes(), ","), r.URL.Query().Get("saved") == "1", ""))
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	cfg := s.paymentConfig()
	fiat, fiatErr := normalizeFiat(r.FormValue("fiat"))
	tradeTypes, tradeErr := normalizeTradeTypes(r.FormValue("trade_types"))
	baseURL, baseErr := normalizeHTTPURL(r.FormValue("bepusdt_base_url"), true)
	publicURL, publicErr := normalizeHTTPURL(r.FormValue("shop_public_base_url"), true)
	notifyURL, notifyErr := normalizeHTTPURL(r.FormValue("bepusdt_notify_url"), false)
	timeoutText := strings.TrimSpace(r.FormValue("bepusdt_timeout_sec"))
	if timeoutText == "" {
		timeoutText = strconv.Itoa(cfg.BepusdtTimeoutSec)
	}
	timeoutSec, timeoutErr := strconv.Atoi(timeoutText)
	if timeoutErr == nil && timeoutSec <= 0 {
		timeoutErr = errors.New("超时时间必须大于 0")
	}
	if fiatErr != nil || tradeErr != nil || baseErr != nil || publicErr != nil || notifyErr != nil || timeoutErr != nil {
		errMsg := ""
		for _, err := range []error{fiatErr, tradeErr, baseErr, publicErr, notifyErr, timeoutErr} {
			if err != nil {
				errMsg = err.Error()
				break
			}
		}
		d := data(cfg, r.FormValue("fiat"), r.FormValue("trade_types"), false, errMsg)
		d["BepusdtBaseURL"] = r.FormValue("bepusdt_base_url")
		d["PublicBaseURL"] = r.FormValue("shop_public_base_url")
		d["NotifyURL"] = r.FormValue("bepusdt_notify_url")
		d["TimeoutSec"] = r.FormValue("bepusdt_timeout_sec")
		s.render(w, r, 400, "admin_settings", d)
		return
	}
	set := func(key, value string) bool {
		if err := db.SetSetting(s.db, key, strings.TrimSpace(value)); err != nil {
			http.Error(w, err.Error(), 500)
			return false
		}
		return true
	}
	if !set("bepusdt_fiat", fiat) ||
		!set("bepusdt_trade_types", tradeTypes) ||
		!set("bepusdt_base_url", baseURL) ||
		!set("shop_public_base_url", publicURL) ||
		!set("bepusdt_notify_url", notifyURL) ||
		!set("bepusdt_timeout_sec", strconv.Itoa(timeoutSec)) {
		return
	}
	if v := strings.TrimSpace(r.FormValue("bepusdt_api_token")); v != "" {
		if !set("bepusdt_api_token", v) {
			return
		}
	}
	http.Redirect(w, r, "/admin/settings?saved=1", http.StatusSeeOther)
}

func (s *Server) handleAdminNotify(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		cfg := s.notifier.CurrentConfig()
		mailSubject, mailBody, telegramBody := s.notifier.PaidTemplates()
		s.render(w, r, 200, "admin_notify", map[string]any{
			"Title":            "通知设置",
			"SMTPHost":         cfg.SMTPHost,
			"SMTPPort":         cfg.SMTPPort,
			"SMTPUsername":     cfg.SMTPUsername,
			"SMTPFrom":         cfg.SMTPFrom,
			"SMTPPasswordSet":  cfg.SMTPPassword != "",
			"TelegramChatID":   cfg.TelegramChatID,
			"TelegramTokenSet": cfg.TelegramBotToken != "",
			"MailPaidSubject":  mailSubject,
			"MailPaidBody":     mailBody,
			"TelegramPaidBody": telegramBody,
			"Notice":           r.URL.Query().Get("notice"),
			"NoticeOK":         r.URL.Query().Get("ok") == "1",
		})
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	portText := strings.TrimSpace(r.FormValue("smtp_port"))
	if portText == "" {
		portText = "465"
	}
	port, err := strconv.Atoi(portText)
	if err != nil || port < 1 || port > 65535 {
		s.adminNotifyRedirect(w, r, false, "SMTP 端口必须是 1-65535 的数字")
		return
	}
	set := func(key, value string) bool {
		if err := db.SetSetting(s.db, key, strings.TrimSpace(value)); err != nil {
			s.adminNotifyRedirect(w, r, false, err.Error())
			return false
		}
		return true
	}
	if !set("smtp_host", r.FormValue("smtp_host")) ||
		!set("smtp_port", strconv.Itoa(port)) ||
		!set("smtp_username", r.FormValue("smtp_username")) ||
		!set("smtp_from", r.FormValue("smtp_from")) ||
		!set("telegram_chat_id", r.FormValue("telegram_chat_id")) ||
		!set("mail_paid_subject", r.FormValue("mail_paid_subject")) ||
		!set("mail_paid_body", r.FormValue("mail_paid_body")) ||
		!set("telegram_paid_body", r.FormValue("telegram_paid_body")) {
		return
	}
	if v := strings.TrimSpace(r.FormValue("smtp_password")); v != "" {
		if !set("smtp_password", v) {
			return
		}
	}
	if v := strings.TrimSpace(r.FormValue("telegram_bot_token")); v != "" {
		if !set("telegram_bot_token", v) {
			return
		}
	}
	s.adminNotifyRedirect(w, r, true, "已保存")
}

func (s *Server) handleAdminNotifyTestEmail(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	to := strings.TrimSpace(r.FormValue("test_email"))
	if !validEmail(to) {
		s.adminNotifyRedirect(w, r, false, "测试邮箱无效")
		return
	}
	if err := s.notifier.SendTestEmail(to); err != nil {
		s.adminNotifyRedirect(w, r, false, "邮件测试失败："+err.Error())
		return
	}
	s.adminNotifyRedirect(w, r, true, "邮件测试已发送")
}

func (s *Server) handleAdminNotifyTestTelegram(w http.ResponseWriter, r *http.Request) {
	if err := s.notifier.SendTestTelegram(); err != nil {
		s.adminNotifyRedirect(w, r, false, "Telegram 测试失败："+err.Error())
		return
	}
	s.adminNotifyRedirect(w, r, true, "Telegram 测试已发送")
}

func (s *Server) adminNotifyRedirect(w http.ResponseWriter, r *http.Request, ok bool, notice string) {
	okValue := "0"
	if ok {
		okValue = "1"
	}
	http.Redirect(w, r, "/admin/notify?ok="+okValue+"&notice="+url.QueryEscape(notice), http.StatusSeeOther)
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

func normalizeTradeTypes(v string) (string, error) {
	seen := make(map[string]bool)
	var out []string
	for _, part := range strings.Split(v, ",") {
		p := strings.ToLower(strings.TrimSpace(part))
		if p == "" {
			continue
		}
		if !validTradeType(p) {
			return "", fmt.Errorf("无效的收款类型：%s", p)
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

var turnstileHTTP = &http.Client{Timeout: 10 * time.Second}

func (s *Server) verifyTurnstile(r *http.Request) error {
	return s.verifyTurnstileToken(strings.TrimSpace(r.FormValue("cf-turnstile-response")), clientIP(r))
}

func (s *Server) verifyTurnstileToken(token, remoteIP string) error {
	secret := s.turnstileSecret()
	if secret == "" {
		return errors.New("TURNSTILE_SECRET is not configured")
	}
	if token == "" {
		return errors.New("missing cf-turnstile-response")
	}
	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	if remoteIP != "" {
		form.Set("remoteip", remoteIP)
	}
	req, err := http.NewRequest(http.MethodPost, "https://challenges.cloudflare.com/turnstile/v0/siteverify", strings.NewReader(form.Encode()))
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	resp, err := turnstileHTTP.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	var result struct {
		Success    bool     `json:"success"`
		ErrorCodes []string `json:"error-codes"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return err
	}
	if !result.Success {
		return fmt.Errorf("siteverify rejected token: %s", strings.Join(result.ErrorCodes, ","))
	}
	return nil
}

func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil {
		return host
	}
	return r.RemoteAddr
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

func validEmail(v string) bool {
	v = strings.TrimSpace(v)
	if v == "" || len(v) > 200 || strings.ContainsAny(v, " \t\r\n") {
		return false
	}
	at := strings.LastIndex(v, "@")
	if at <= 0 || at == len(v)-1 {
		return false
	}
	return strings.Contains(v[at+1:], ".")
}

// startOfDay 返回当天 00:00 的 Unix 时间戳（北京时间）。
func startOfDay(now int64) int64 {
	t := time.Unix(now, 0).In(models.BeijingLocation)
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, models.BeijingLocation).Unix()
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

func (s *Server) handleIndex(w http.ResponseWriter, r *http.Request) {
	products, err := s.listProductViews(true)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	st := s.siteSettings()
	data := s.publicData(r, st.Title)
	data["Categories"] = groupIndexProducts(products)
	s.render(w, r, 200, "public_index", data)
}

func groupIndexProducts(products []ProductView) []CategoryView {
	var pinned []ProductView
	categoryOrder := []string{}
	categoryMap := map[string]int{}
	for _, p := range products {
		if p.Product.IsPinned {
			pinned = append(pinned, p)
			continue
		}
		name := p.Product.Category
		if strings.TrimSpace(name) == "" {
			name = "默认分类"
		}
		if _, ok := categoryMap[name]; !ok {
			categoryMap[name] = len(categoryOrder)
			categoryOrder = append(categoryOrder, name)
		}
	}
	var out []CategoryView
	if len(pinned) > 0 {
		out = append(out, CategoryView{Name: "置顶", DefaultKey: "pinned", Products: pinned})
	}
	for _, name := range categoryOrder {
		var items []ProductView
		isDefault := name == "默认分类"
		for _, p := range products {
			if p.Product.IsPinned {
				continue
			}
			cat := p.Product.Category
			if strings.TrimSpace(cat) == "" {
				cat = "默认分类"
			}
			if cat == name {
				items = append(items, p)
			}
		}
		if len(items) > 0 {
			key := ""
			if isDefault {
				key = "default_category"
			}
			out = append(out, CategoryView{Name: name, DefaultKey: key, Products: items})
		}
	}
	return out
}

func (s *Server) productPageData(r *http.Request, p models.Product, available int) map[string]any {
	data := s.publicData(r, p.Name)
	data["Product"] = p
	data["Available"] = available
	data["TradeTypes"] = s.tradeTypes()
	data["TurnstileSiteKey"] = s.turnstileSiteKey()
	data["Qty"] = 1
	if len(data["TradeTypes"].([]string)) > 0 {
		data["TradeType"] = data["TradeTypes"].([]string)[0]
	}
	if strings.TrimSpace(p.Description) != "" {
		data["SEODescription"] = truncateString(p.Description, 160)
	}
	return data
}

func (s *Server) renderProductFormError(w http.ResponseWriter, r *http.Request, p models.Product, available int, tradeType, contact string, qty int, message string, status int) {
	data := s.productPageData(r, p, available)
	data["Error"] = message
	data["TradeType"] = tradeType
	data["Contact"] = contact
	if qty > 0 {
		data["Qty"] = qty
	}
	s.render(w, r, status, "public_product", data)
}

func (s *Server) handleProduct(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	p, available, err := s.getProductView(id)
	if err != nil || p.Status != "active" {
		http.NotFound(w, r)
		return
	}
	s.render(w, r, 200, "public_product", s.productPageData(r, p, available))
}

func (s *Server) handleCreateOrder(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	productID, _ := strconv.ParseInt(r.FormValue("product_id"), 10, 64)
	qty, _ := strconv.Atoi(r.FormValue("qty"))
	contact := strings.TrimSpace(r.FormValue("contact"))
	tradeType := strings.TrimSpace(r.FormValue("trade_type"))
	p, available, err := s.getProductView(productID)
	if err != nil || p.Status != "active" {
		http.NotFound(w, r)
		return
	}
	if qty <= 0 {
		qty = 1
	}
	if qty > 100 {
		qty = 100
	}
	if tradeType == "" {
		tradeType = s.tradeTypes()[0]
	}
	if err := s.verifyTurnstile(r); err != nil {
		log.Printf("turnstile verify failed: %v", err)
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, tr(chooseLang(r), "turnstile_failed"), http.StatusForbidden)
		return
	}
	if !s.tradeTypeAllowed(tradeType) {
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, tr(chooseLang(r), "invalid_trade_type"), 400)
		return
	}
	if !validEmail(contact) || qty > available {
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, tr(chooseLang(r), "invalid_contact"), 400)
		return
	}
	now := models.Now()
	order := models.Order{
		OrderNo:      models.NewOrderNo(),
		ProductID:    p.ID,
		ProductName:  p.Name,
		Qty:          qty,
		AmountCents:  p.PriceCents * int64(qty),
		Fiat:         s.fiat(),
		TradeType:    tradeType,
		BuyerContact: contact,
		Status:       "pending",
		CreatedAt:    now,
		UpdatedAt:    now,
	}
	if err := s.createPendingOrder(&order); err != nil {
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, tr(chooseLang(r), "out_of_stock"), 400)
		return
	}
	payCfg := s.paymentConfig()
	redirectURL := payCfg.PublicBaseURL + "/order/" + order.OrderNo + "?contact=" + url.QueryEscape(contact)
	paymentURL, tradeID, err := s.payClient().CreateTransaction(bepusdt.CreateInput{
		OrderID:     order.OrderNo,
		AmountYuan:  float64(order.AmountCents) / 100,
		Fiat:        s.fiat(),
		TradeType:   tradeType,
		Name:        fmt.Sprintf("%s x%d", p.Name, qty),
		NotifyURL:   payCfg.NotifyURL,
		RedirectURL: redirectURL,
		TimeoutSec:  payCfg.BepusdtTimeoutSec,
	})
	if err != nil {
		_ = s.failOrder(order.ID)
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, tr(chooseLang(r), "create_payment_failed")+err.Error(), 502)
		return
	}
	_, _ = s.db.Exec(`UPDATE orders SET trade_id = ?, payment_url = ?, updated_at = ? WHERE id = ?`, tradeID, paymentURL, models.Now(), order.ID)
	http.Redirect(w, r, paymentURL, http.StatusSeeOther)
}

func (s *Server) handleOrderLookup(w http.ResponseWriter, r *http.Request) {
	orderNo := strings.TrimSpace(r.URL.Query().Get("order_no"))
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	if orderNo == "" {
		data := s.publicData(r, tr(chooseLang(r), "order_query"))
		data["Robots"] = "noindex,nofollow"
		data["NoIndex"] = true
		s.render(w, r, 200, "public_order_lookup", data)
		return
	}
	target := "/order/" + url.PathEscape(orderNo)
	if contact != "" {
		target += "?contact=" + url.QueryEscape(contact)
	}
	http.Redirect(w, r, target, http.StatusSeeOther)
}

func (s *Server) handleOrder(w http.ResponseWriter, r *http.Request) {
	orderNo := r.PathValue("orderNo")
	order, err := s.getOrderByNo(orderNo)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	data := s.publicData(r, tr(chooseLang(r), "order_query"))
	data["Robots"] = "noindex,nofollow"
	data["NoIndex"] = true
	data["OrderNo"] = orderNo
	if contact == "" {
		data["NeedContact"] = true
		s.render(w, r, 200, "public_order", data)
		return
	}
	if contact != order.BuyerContact {
		data["Error"] = tr(chooseLang(r), "contact_mismatch")
		s.render(w, r, 403, "public_order", data)
		return
	}
	data["Order"] = order
	if order.Status == "paid" {
		cards, _ := s.getOrderCards(order.ID)
		data["Cards"] = cards
	}
	s.render(w, r, 200, "public_order", data)
}

func (s *Server) handleBepusdtNotify(w http.ResponseWriter, r *http.Request) {
	payCfg := s.paymentConfig()
	if payCfg.BepusdtToken == "" {
		http.Error(w, "bepusdt token not configured", 500)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad body", 400)
		return
	}
	params, err := bepusdt.ParseAndVerifyCallback(body, payCfg.BepusdtToken)
	if err != nil {
		log.Printf("bepusdt notify verify failed: %v; body=%s", err, string(body))
		http.Error(w, "invalid signature", 400)
		return
	}
	switch params["status"] {
	case "2":
		order, cards, changed, err := s.orders.MarkPaidAndDeliver(params["order_id"], params["trade_id"], params["block_transaction_id"])
		if err != nil {
			log.Printf("mark paid %s: %v", params["order_id"], err)
			go s.notifier.NotifySystemError("支付回调处理异常 order=" + params["order_id"] + ": " + err.Error())
		}
		if changed {
			payPayload := s.notifier.OrderPayload(notify.EventPaymentSuccess, order, nil, nil)
			go s.notifier.Notify(notify.EventPaymentSuccess, payPayload)
			deliverPayload := s.notifier.OrderPayload(notify.EventDelivered, order, cards, nil)
			go s.notifier.Notify(notify.EventDelivered, deliverPayload)
		}
	case "3":
		if o, oerr := s.orders.Repo().GetOrderByNo(params["order_id"]); oerr == nil && o.TradeID != "" {
			go func(tradeID string) {
				_ = s.payClient().CancelTransaction(tradeID)
			}(o.TradeID)
			_ = s.orders.Expire(o.ID)
		}
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) listProductViews(activeOnly bool) ([]ProductView, error) {
	where := ""
	if activeOnly {
		where = "WHERE p.status = 'active'"
	}
	rows, err := s.db.Query(`SELECT p.id, p.name, p.description, p.image_url, p.price_cents, p.status, p.category, p.sort_order, p.is_pinned, p.faq, p.created_at, p.updated_at,
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'available'),
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'locked'),
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'sold')
		FROM products p ` + where + ` ORDER BY p.is_pinned DESC, p.sort_order ASC, p.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProductView
	for rows.Next() {
		var v ProductView
		var faqRaw string
		if err := rows.Scan(&v.Product.ID, &v.Product.Name, &v.Product.Description, &v.Product.ImageURL, &v.Product.PriceCents, &v.Product.Status, &v.Product.Category, &v.Product.SortOrder, &v.Product.IsPinned, &faqRaw, &v.Product.CreatedAt, &v.Product.UpdatedAt, &v.Available, &v.Reserved, &v.Sold); err != nil {
			return nil, err
		}
		v.Product.FAQ = parseFAQ(faqRaw)
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Server) getProductView(id int64) (models.Product, int, error) {
	var p models.Product
	var available int
	var faqRaw string
	err := s.db.QueryRow(`SELECT p.id, p.name, p.description, p.image_url, p.price_cents, p.status, p.category, p.sort_order, p.is_pinned, p.faq, p.created_at, p.updated_at,
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'available')
		FROM products p WHERE p.id = ?`, id).Scan(&p.ID, &p.Name, &p.Description, &p.ImageURL, &p.PriceCents, &p.Status, &p.Category, &p.SortOrder, &p.IsPinned, &faqRaw, &p.CreatedAt, &p.UpdatedAt, &available)
	if err != nil {
		return p, 0, err
	}
	p.FAQ = parseFAQ(faqRaw)
	return p, available, nil
}

func parseFAQ(raw string) []models.FAQItem {
	var out []models.FAQItem
	if strings.TrimSpace(raw) == "" {
		return out
	}
	if err := json.Unmarshal([]byte(raw), &out); err != nil {
		return nil
	}
	return out
}

// getProductViewBySlug 按 slug 查找商品。
func (s *Server) getProductViewBySlug(slug string) (models.Product, int, error) {
	var p models.Product
	var available int
	rows, err := s.db.Query(`SELECT p.id, p.name, p.description, p.image_url, p.price_cents, p.status, p.category, p.sort_order, p.is_pinned, p.faq, p.created_at, p.updated_at,
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'available')
		FROM products p WHERE p.status = 'active'`)
	if err != nil {
		return p, 0, err
	}
	defer rows.Close()
	for rows.Next() {
		var t models.Product
		var av int
		var faqRaw string
		if err := rows.Scan(&t.ID, &t.Name, &t.Description, &t.ImageURL, &t.PriceCents, &t.Status, &t.Category, &t.SortOrder, &t.IsPinned, &faqRaw, &t.CreatedAt, &t.UpdatedAt, &av); err != nil {
			return p, 0, err
		}
		if models.Slugify(t.Name) == slug {
			t.FAQ = parseFAQ(faqRaw)
			p = t
			available = av
			break
		}
	}
	if p.ID == 0 {
		return p, 0, sql.ErrNoRows
	}
	return p, available, nil
}

func (s *Server) createPendingOrder(order *models.Order) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'created', ?, ?)`, order.OrderNo, order.ProductID, order.ProductName, order.Qty, order.AmountCents, order.Fiat, order.TradeType, order.BuyerContact, order.CreatedAt, order.UpdatedAt)
	if err != nil {
		return err
	}
	order.ID, _ = res.LastInsertId()
	rows, err := tx.Query(`SELECT id FROM cards WHERE product_id = ? AND status = 'available' LIMIT ?`, order.ProductID, order.Qty)
	if err != nil {
		return err
	}
	var ids []int64
	for rows.Next() {
		var id int64
		if err := rows.Scan(&id); err != nil {
			rows.Close()
			return err
		}
		ids = append(ids, id)
	}
	rows.Close()
	if len(ids) != order.Qty {
		return errors.New("insufficient card stock")
	}
	for _, id := range ids {
		if _, err := tx.Exec(`UPDATE cards SET status = 'locked', reserved_order = ?, updated_at = ? WHERE id = ? AND status = 'available'`, order.ID, models.Now(), id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Server) failOrder(orderID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, models.Now(), orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE orders SET status = 'failed', updated_at = ? WHERE id = ? AND status = 'pending'`, models.Now(), orderID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Server) getOrderByNo(orderNo string) (models.Order, error) {
	return scanOrder(s.db.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE order_no = ?`, orderNo))
}

func (s *Server) getOrderByID(id int64) (models.Order, error) {
	return scanOrder(s.db.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE id = ?`, id))
}

func scanOrder(row *sql.Row) (models.Order, error) {
	var o models.Order
	err := row.Scan(&o.ID, &o.OrderNo, &o.ProductID, &o.ProductName, &o.Qty, &o.AmountCents, &o.Fiat, &o.TradeType, &o.BuyerContact, &o.Status, &o.TradeID, &o.PaymentURL, &o.BlockTransactionID, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt)
	return o, err
}

func (s *Server) getOrderCards(orderID int64) ([]models.Card, error) {
	rows, err := s.db.Query(`SELECT id, product_id, reserved_order, sold_order, content, status, created_at, updated_at, sold_at FROM cards WHERE sold_order = ? ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Card
	for rows.Next() {
		var c models.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.ReservedOrder, &c.SoldOrder, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

// markPaid 处理支付回调：waiting_payment -> paid，并记录事件日志。
func (s *Server) markPaid(params map[string]string) (models.Order, bool, error) {
	orderNo := params["order_id"]
	tx, err := s.db.Begin()
	if err != nil {
		return models.Order{}, false, err
	}
	defer tx.Rollback()
	var o models.Order
	err = tx.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE order_no = ?`, orderNo).Scan(&o.ID, &o.OrderNo, &o.ProductID, &o.ProductName, &o.Qty, &o.AmountCents, &o.Fiat, &o.TradeType, &o.BuyerContact, &o.Status, &o.TradeID, &o.PaymentURL, &o.BlockTransactionID, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt)
	if err != nil {
		return models.Order{}, false, err
	}
	if o.Status == models.OrderPaid || o.Status == models.OrderProcessing || o.Status == models.OrderDelivered || o.Status == models.OrderCompleted {
		if err := tx.Commit(); err != nil {
			return models.Order{}, false, err
		}
		return o, false, nil
	}
	if o.Status != models.OrderWaitingPayment {
		return o, false, tx.Commit()
	}
	now := models.Now()
	res, err := tx.Exec(`UPDATE orders SET status = ?, trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = ?`, models.OrderPaid, params["trade_id"], params["block_transaction_id"], now, now, o.ID, models.OrderWaitingPayment)
	if err != nil {
		return models.Order{}, false, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return o, false, tx.Commit()
	}
	if err := tx.Commit(); err != nil {
		return models.Order{}, false, err
	}
	o.Status = models.OrderPaid
	o.TradeID = params["trade_id"]
	o.BlockTransactionID = params["block_transaction_id"]
	o.PaidAt = now
	_ = db.AddOrderLog(s.db, o.ID, "payment_success", "支付成功", models.OrderWaitingPayment, models.OrderPaid, 0, "")
	return o, true, nil
}

// deliverOrder 执行发卡（释放卡密为 sold），并在成功后推进到 delivered。
// 返回卡密与是否发生变更。
func (s *Server) deliverOrder(order models.Order) ([]models.Card, bool, error) {
	tx, err := s.db.Begin()
	if err != nil {
		return nil, false, err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE cards SET status = 'sold', sold_order = ?, reserved_order = 0, sold_at = ?, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, order.ID, models.Now(), models.Now(), order.ID); err != nil {
		return nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return nil, false, err
	}
	cards, _ := s.getOrderCards(order.ID)
	if len(cards) == 0 {
		// 没有预留卡密，视为发卡失败
		_ = s.setOrderStatusWithLog(order.ID, models.OrderDeliveryFailed, "delivery_failed", "发卡失败：无可用卡密", 0)
		return nil, false, nil
	}
	if err := s.setOrderStatusWithLog(order.ID, models.OrderDelivered, "delivered", "卡密已发放", 0); err != nil {
		return nil, false, err
	}
	return cards, true, nil
}

func (s *Server) markExpiredByOrderNo(orderNo string) error {
	o, err := s.getOrderByNo(orderNo)
	if err != nil {
		return err
	}
	if o.TradeID != "" {
		go func(tradeID string) {
			_ = s.payClient().CancelTransaction(tradeID)
		}(o.TradeID)
	}
	return s.expireOrder(o.ID)
}

func (s *Server) expireOrder(orderID int64) error {
	var from string
	_ = s.db.QueryRow(`SELECT status FROM orders WHERE id = ?`, orderID).Scan(&from)
	// 仅等待支付或 created 状态可过期
	if from != models.OrderWaitingPayment && from != models.OrderCreated {
		return nil
	}
	return s.cancelOrExpire(orderID, from, models.OrderExpired, "expired", "订单已过期")
}

func (s *Server) cancelOrder(orderID int64) error {
	var from string
	_ = s.db.QueryRow(`SELECT status FROM orders WHERE id = ?`, orderID).Scan(&from)
	if from != models.OrderWaitingPayment && from != models.OrderCreated {
		return nil
	}
	return s.cancelOrExpire(orderID, from, models.OrderCancelled, "cancelled", "订单已取消")
}

// cancelOrExpire 释放预留卡密并将订单置为取消/过期，记录日志。
func (s *Server) cancelOrExpire(orderID int64, from, to, event, message string) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE cards SET status = 'available', reserved_order = 0, updated_at = ? WHERE reserved_order = ? AND status = 'locked'`, models.Now(), orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE orders SET status = ?, updated_at = ? WHERE id = ? AND status = ?`, to, models.Now(), orderID, from); err != nil {
		return err
	}
	if err := tx.Commit(); err != nil {
		return err
	}
	return db.AddOrderLog(s.db, orderID, event, message, from, to, 0, "")
}

func (s *Server) setOrderStatus(orderID int64, status string) error {
	return s.setOrderStatusWithLog(orderID, status, "status_changed", "状态变更", 0)
}

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if !db.HasAdmin(s.db) {
		http.Redirect(w, r, "/setup", http.StatusSeeOther)
		return
	}
	if r.Method == http.MethodGet {
		s.render(w, r, 200, "admin_login", map[string]any{"Title": "后台登录"})
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	username := strings.TrimSpace(r.FormValue("username"))
	password := r.FormValue("password")
	var adminID int64
	var hash string
	err := s.db.QueryRow(`SELECT id, password_hash FROM admins WHERE username = ?`, username).Scan(&adminID, &hash)
	if err != nil || !models.CheckPassword(password, hash) {
		s.render(w, r, 403, "admin_login", map[string]any{"Title": "admin_login", "Error": tr(chooseLang(r), "login_error")})
		return
	}
	s.startSession(w, adminID)
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}

func (s *Server) handleSetup(w http.ResponseWriter, r *http.Request) {
	if db.HasAdmin(s.db) {
		http.Redirect(w, r, "/admin", http.StatusSeeOther)
		return
	}
	if r.Method == http.MethodGet {
		scheme := "https"
		if r.TLS == nil && r.Header.Get("X-Forwarded-Proto") == "" {
			scheme = "http"
		}
		suggestedBase := scheme + "://" + r.Host
		s.render(w, r, 200, "admin_setup", map[string]any{"Title": "初始化设置", "SiteTitle": "LiteShop", "SuggestedBaseURL": suggestedBase})
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	username := strings.TrimSpace(r.FormValue("admin_username"))
	if username == "" {
		username = "admin"
	}
	password := r.FormValue("admin_password")
	confirm := r.FormValue("admin_confirm")
	if len(password) < 8 {
		s.render(w, r, 400, "admin_setup", map[string]any{"Title": "setup", "Error": tr(chooseLang(r), "password_too_short"), "SiteTitle": strings.TrimSpace(r.FormValue("site_title")), "AdminUsername": username})
		return
	}
	if password != confirm {
		s.render(w, r, 400, "admin_setup", map[string]any{"Title": "setup", "Error": tr(chooseLang(r), "password_mismatch"), "SiteTitle": strings.TrimSpace(r.FormValue("site_title")), "AdminUsername": username})
		return
	}
	siteTitle := strings.TrimSpace(r.FormValue("site_title"))
	if siteTitle == "" {
		siteTitle = "LiteShop"
	}
	if err := db.SeedAdmin(s.db, username, password); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	settings := map[string]string{
		"site_title":          siteTitle,
		"site_copyright":      "© {{year}} {{site_title}}. All rights reserved.",
		"bepusdt_fiat":        strings.TrimSpace(r.FormValue("bepusdt_fiat")),
		"bepusdt_timeout_sec": "1200",
	}
	if v := strings.TrimSpace(r.FormValue("shop_public_base_url")); v != "" {
		settings["shop_public_base_url"] = v
	}
	if v := strings.TrimSpace(r.FormValue("bepusdt_base_url")); v != "" {
		settings["bepusdt_base_url"] = v
	}
	if v := strings.TrimSpace(r.FormValue("bepusdt_api_token")); v != "" {
		settings["bepusdt_api_token"] = v
	}
	if v := strings.TrimSpace(r.FormValue("bepusdt_trade_types")); v != "" {
		settings["bepusdt_trade_types"] = v
	}
	if v := strings.TrimSpace(r.FormValue("turnstile_site_key")); v != "" {
		settings["turnstile_site_key"] = v
	}
	if v := strings.TrimSpace(r.FormValue("turnstile_secret")); v != "" {
		settings["turnstile_secret"] = v
	}
	if settings["bepusdt_fiat"] == "" {
		settings["bepusdt_fiat"] = "CNY"
	}
	for k, v := range settings {
		if err := db.SetSetting(s.db, k, v); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
	}
	http.Redirect(w, r, "/admin/login?setup=done", http.StatusSeeOther)
}

func (s *Server) handleAdminSystemBackup(w http.ResponseWriter, r *http.Request) {
	settings, err := db.AllSettings(s.db)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	payload := struct {
		App        string            `json:"app"`
		ExportedAt int64             `json:"exported_at"`
		Settings   map[string]string `json:"settings"`
	}{App: "liteshop", ExportedAt: models.Now(), Settings: settings}
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Content-Disposition", "attachment; filename=liteshop-settings.json")
	_ = json.NewEncoder(w).Encode(payload)
}

func (s *Server) handleAdminSystemRestore(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseMultipartForm(8 << 20); err != nil {
		http.Error(w, "bad upload", 400)
		return
	}
	file, _, err := r.FormFile("backup_file")
	if err != nil {
		http.Redirect(w, r, "/admin/system?restore=0", http.StatusSeeOther)
		return
	}
	defer file.Close()
	var payload struct {
		Settings map[string]string `json:"settings"`
	}
	if err := json.NewDecoder(io.LimitReader(file, 8<<20)).Decode(&payload); err != nil {
		http.Redirect(w, r, "/admin/system?restore=0", http.StatusSeeOther)
		return
	}
	if len(payload.Settings) == 0 {
		http.Redirect(w, r, "/admin/system?restore=0", http.StatusSeeOther)
		return
	}
	keyPattern := regexp.MustCompile(`^[a-z0-9_]+$`)
	count := 0
	for k, v := range payload.Settings {
		if !keyPattern.MatchString(k) || len(k) > 80 || len(v) > 20000 {
			continue
		}
		if err := db.SetSetting(s.db, k, v); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		count++
	}
	http.Redirect(w, r, fmt.Sprintf("/admin/system?restore=1&count=%d", count), http.StatusSeeOther)
}

func (s *Server) handleAdminSystem(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, 200, "admin_system", map[string]any{
		"Title":        "系统",
		"Restore":      r.URL.Query().Get("restore"),
		"RestoreCount": r.URL.Query().Get("count"),
	})
}

func (s *Server) handleAdminSystemReset(w http.ResponseWriter, r *http.Request) {
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	if strings.TrimSpace(r.FormValue("confirm")) != "DELETE" {
		http.Redirect(w, r, "/admin/system?reset=0", http.StatusSeeOther)
		return
	}
	if err := db.ResetAllTables(s.db); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	s.sessMu.Lock()
	s.sessions = make(map[string]sessionInfo)
	s.sessMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/setup", http.StatusSeeOther)
}

func (s *Server) handleAdminAccount(w http.ResponseWriter, r *http.Request) {
	var currentUsername string
	_ = s.db.QueryRow(`SELECT username FROM admins WHERE id = 1`).Scan(&currentUsername)
	if r.Method == http.MethodGet {
		s.render(w, r, 200, "admin_account", map[string]any{"Title": "账号设置", "Username": currentUsername, "Saved": r.URL.Query().Get("saved") == "1"})
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	username := strings.TrimSpace(r.FormValue("username"))
	currentPassword := r.FormValue("current_password")
	newPassword := r.FormValue("new_password")
	confirmPassword := r.FormValue("confirm_password")
	renderErr := func(msg string) {
		s.render(w, r, 400, "admin_account", map[string]any{"Title": "account", "Username": username, "Error": msg})
	}
	var hash string
	if err := s.db.QueryRow(`SELECT password_hash FROM admins WHERE id = 1`).Scan(&hash); err != nil || !models.CheckPassword(currentPassword, hash) {
		renderErr(tr(chooseLang(r), "current_password_wrong"))
		return
	}
	if username == "" {
		renderErr(tr(chooseLang(r), "username_empty"))
		return
	}
	if newPassword != "" {
		if len(newPassword) < 8 {
			renderErr(tr(chooseLang(r), "password_too_short"))
			return
		}
		if newPassword != confirmPassword {
			renderErr(tr(chooseLang(r), "password_mismatch"))
			return
		}
		hash = models.HashPassword(newPassword)
	}
	if _, err := s.db.Exec(`UPDATE admins SET username = ?, password_hash = ? WHERE id = 1`, username, hash); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	http.Redirect(w, r, "/admin/account?saved=1", http.StatusSeeOther)
}

func (s *Server) handleAdminLogout(w http.ResponseWriter, r *http.Request) {
	if id, ok := s.sessionID(r); ok {
		s.sessMu.Lock()
		delete(s.sessions, id)
		s.sessMu.Unlock()
	}
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: "", Path: "/", MaxAge: -1})
	http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
}

func (s *Server) requireAdmin(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.isAdmin(r) {
			http.Redirect(w, r, "/admin/login", http.StatusSeeOther)
			return
		}
		next.ServeHTTP(w, r)
	})
}

// requireAdminAPI 要求至少 viewer 权限（登录即可访问）。
func (s *Server) requireAdminAPI(next http.Handler) http.Handler {
	return s.requireRole(models.RoleViewer, next)
}

// requireRole 要求至少指定角色权限。
func (s *Server) requireRole(min string, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.roleAtLeast(r, min) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		next.ServeHTTP(w, r)
	})
}

// audit 记录一条管理员审计日志（记录谁/何时/改了什么/前后值）。
func (s *Server) audit(r *http.Request, action, targetType, targetID, before, after string) {
	_ = db.AddAuditLog(s.db, s.currentAdminID(r), s.currentAdminName(r), action, targetType, targetID, before, after)
}

func (s *Server) startSession(w http.ResponseWriter, adminID int64) {
	id := models.RandomToken(24)
	s.sessMu.Lock()
	s.sessions[id] = sessionInfo{AdminID: adminID, Expiry: time.Now().Add(12 * time.Hour)}
	s.sessMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: id + "." + s.signSession(id), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Now().Add(12 * time.Hour)})
}

func (s *Server) sessionID(r *http.Request) (string, bool) {
	c, err := r.Cookie("shop_session")
	if err != nil {
		return "", false
	}
	parts := strings.Split(c.Value, ".")
	if len(parts) != 2 {
		return "", false
	}
	if !hmac.Equal([]byte(parts[1]), []byte(s.signSession(parts[0]))) {
		return "", false
	}
	return parts[0], true
}

func (s *Server) sessionSecret() string {
	if v, err := db.GetSetting(s.db, "session_secret"); err == nil && strings.TrimSpace(v) != "" {
		return v
	}
	secret := models.RandomToken(32)
	_ = db.SetSetting(s.db, "session_secret", secret)
	return secret
}

func (s *Server) turnstileSecret() string {
	if v, err := db.GetSetting(s.db, "turnstile_secret"); err == nil && strings.TrimSpace(v) != "" {
		return v
	}
	return s.cfg.TurnstileSecret
}

func (s *Server) turnstileSiteKey() string {
	if v, err := db.GetSetting(s.db, "turnstile_site_key"); err == nil && strings.TrimSpace(v) != "" {
		return v
	}
	return s.cfg.TurnstileSiteKey
}

func (s *Server) signSession(id string) string {
	h := hmac.New(sha256.New, []byte(s.sessionSecret()))
	h.Write([]byte(id))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func (s *Server) isAdmin(r *http.Request) bool {
	_, _, ok := s.currentSession(r)
	return ok
}

// currentSession 返回当前登录管理员的 adminID 与角色；未登录返回 (0, "", false)。
func (s *Server) currentSession(r *http.Request) (int64, string, bool) {
	id, ok := s.sessionID(r)
	if !ok {
		return 0, "", false
	}
	s.sessMu.Lock()
	info, ok := s.sessions[id]
	if ok && time.Now().Before(info.Expiry) {
		s.sessions[id] = sessionInfo{AdminID: info.AdminID, Expiry: time.Now().Add(12 * time.Hour)}
	} else {
		delete(s.sessions, id)
		ok = false
	}
	s.sessMu.Unlock()
	if !ok {
		return 0, "", false
	}
	var role string
	_ = s.db.QueryRow(`SELECT role FROM admins WHERE id = ?`, info.AdminID).Scan(&role)
	if role == "" {
		role = models.RoleViewer
	}
	return info.AdminID, role, true
}

// currentAdminID 返回当前管理员 ID。
func (s *Server) currentAdminID(r *http.Request) int64 {
	id, _, _ := s.currentSession(r)
	return id
}

// currentAdminName 返回当前管理员用户名。
func (s *Server) currentAdminName(r *http.Request) string {
	id, _, ok := s.currentSession(r)
	if !ok {
		return ""
	}
	var name string
	_ = s.db.QueryRow(`SELECT username FROM admins WHERE id = ?`, id).Scan(&name)
	return name
}

// roleAtLeast 判断当前用户是否至少具备指定角色权限。
// 权限层级: viewer < operator < admin。
func (s *Server) roleAtLeast(r *http.Request, min string) bool {
	_, role, ok := s.currentSession(r)
	if !ok {
		return false
	}
	return roleRank(role) >= roleRank(min)
}

func roleRank(role string) int {
	switch role {
	case models.RoleAdmin:
		return 3
	case models.RoleOperator:
		return 2
	case models.RoleViewer:
		return 1
	}
	return 0
}

func (s *Server) handleAdminDashboard(w http.ResponseWriter, r *http.Request) {
	var products, availableCards, pendingOrders, paidOrders int
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM products`).Scan(&products)
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE status = 'available'`).Scan(&availableCards)
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status = 'pending'`).Scan(&pendingOrders)
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status = 'paid'`).Scan(&paidOrders)
	s.render(w, r, 200, "admin_dashboard", map[string]any{"Title": "后台首页", "Products": products, "AvailableCards": availableCards, "PendingOrders": pendingOrders, "PaidOrders": paidOrders})
}

func (s *Server) handleAdminProducts(w http.ResponseWriter, r *http.Request) {
	products, err := s.listProductViews(false)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	s.render(w, r, 200, "admin_products", map[string]any{"Title": "商品管理", "Products": products})
}

func (s *Server) handleAdminProductNew(w http.ResponseWriter, r *http.Request) {
	s.render(w, r, 200, "admin_product_form", map[string]any{"Title": tr(chooseLang(r), "new_product"), "Product": models.Product{Status: "active"}})
}

func (s *Server) handleAdminProductCreate(w http.ResponseWriter, r *http.Request) {
	p, err := s.productFromForm(r)
	if err != nil {
		s.render(w, r, 400, "admin_product_form", map[string]any{"Title": tr(chooseLang(r), "new_product"), "Product": p, "Error": err.Error()})
		return
	}
	now := models.Now()
	_, err = s.db.Exec(`INSERT INTO products(name, description, price_cents, status, category, sort_order, is_pinned, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`, p.Name, p.Description, p.PriceCents, p.Status, p.Category, p.SortOrder, p.IsPinned, now, now)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	http.Redirect(w, r, "/admin/products", http.StatusSeeOther)
}

func (s *Server) handleAdminProductEdit(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	p, _, err := s.getProductView(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	s.render(w, r, 200, "admin_product_form", map[string]any{"Title": tr(chooseLang(r), "edit_product"), "Product": p})
}

func (s *Server) handleAdminProductUpdate(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	p, err := s.productFromForm(r)
	if err != nil {
		p.ID = id
		s.render(w, r, 400, "admin_product_form", map[string]any{"Title": tr(chooseLang(r), "edit_product"), "Product": p, "Error": err.Error()})
		return
	}
	_, err = s.db.Exec(`UPDATE products SET name = ?, description = ?, price_cents = ?, status = ?, category = ?, sort_order = ?, is_pinned = ?, updated_at = ? WHERE id = ?`, p.Name, p.Description, p.PriceCents, p.Status, p.Category, p.SortOrder, p.IsPinned, models.Now(), id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	http.Redirect(w, r, "/admin/products", http.StatusSeeOther)
}

func (s *Server) productFromForm(r *http.Request) (models.Product, error) {
	if err := r.ParseForm(); err != nil {
		return models.Product{}, err
	}
	name := strings.TrimSpace(r.FormValue("name"))
	if name == "" {
		return models.Product{}, errors.New(tr(chooseLang(r), "product_name_empty"))
	}
	price, err := models.CentsFromYuan(strings.TrimSpace(r.FormValue("price")))
	if err != nil || price <= 0 {
		return models.Product{}, errors.New(tr(chooseLang(r), "price_invalid"))
	}
	status := r.FormValue("status")
	if status != "active" {
		status = "disabled"
	}
	category := strings.TrimSpace(r.FormValue("category"))
	sortOrder, _ := strconv.Atoi(strings.TrimSpace(r.FormValue("sort_order")))
	if sortOrder < 0 {
		sortOrder = 0
	}
	isPinned := r.FormValue("is_pinned") == "1"
	return models.Product{Name: name, Description: strings.TrimSpace(r.FormValue("description")), PriceCents: price, Status: status, Category: category, SortOrder: sortOrder, IsPinned: isPinned}, nil
}

func (s *Server) handleAdminCards(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	p, available, err := s.getProductView(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	rows, err := s.db.Query(`SELECT id, product_id, reserved_order, sold_order, content, status, created_at, updated_at, sold_at FROM cards WHERE product_id = ? ORDER BY id DESC LIMIT 500`, id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	var cards []models.Card
	for rows.Next() {
		var c models.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.ReservedOrder, &c.SoldOrder, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		cards = append(cards, c)
	}
	s.render(w, r, 200, "admin_cards", map[string]any{"Title": "卡密管理", "Product": p, "Available": available, "Cards": cards})
}

func (s *Server) handleAdminCardsImport(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if _, _, err := s.getProductView(id); err != nil {
		http.NotFound(w, r)
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	lines := strings.Split(r.FormValue("cards"), "\n")
	tx, err := s.db.Begin()
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer tx.Rollback()
	now := models.Now()
	count := 0
	for _, line := range lines {
		line = strings.TrimSpace(line)
		if line == "" {
			continue
		}
		if _, err := tx.Exec(`INSERT INTO cards(product_id, content, status, created_at, updated_at) VALUES(?, ?, 'available', ?, ?)`, id, line, now, now); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		count++
	}
	if err := tx.Commit(); err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	http.Redirect(w, r, fmt.Sprintf("/admin/products/%d/cards?imported=%d", id, count), http.StatusSeeOther)
}

func (s *Server) handleAdminCardDelete(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	var productID int64
	if err := s.db.QueryRow(`SELECT product_id FROM cards WHERE id = ? AND status = 'available'`, id).Scan(&productID); err != nil {
		http.NotFound(w, r)
		return
	}
	_, _ = s.db.Exec(`DELETE FROM cards WHERE id = ? AND status = 'available'`, id)
	http.Redirect(w, r, fmt.Sprintf("/admin/products/%d/cards", productID), http.StatusSeeOther)
}

func (s *Server) handleAdminOrders(w http.ResponseWriter, r *http.Request) {
	rows, err := s.db.Query(`SELECT id, order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders ORDER BY id DESC LIMIT 200`)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	var orders []models.Order
	for rows.Next() {
		var o models.Order
		if err := rows.Scan(&o.ID, &o.OrderNo, &o.ProductID, &o.ProductName, &o.Qty, &o.AmountCents, &o.Fiat, &o.TradeType, &o.BuyerContact, &o.Status, &o.TradeID, &o.PaymentURL, &o.BlockTransactionID, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		orders = append(orders, o)
	}
	s.render(w, r, 200, "admin_orders", map[string]any{"Title": "订单管理", "Orders": orders})
}

func (s *Server) handleAdminOrder(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	o, err := s.getOrderByID(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	cards, _ := s.getOrderCards(o.ID)
	s.render(w, r, 200, "admin_order", map[string]any{"Title": "订单详情", "Order": o, "Cards": cards})
}

func (s *Server) handleAdminOrderExpire(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if o, err := s.getOrderByID(id); err == nil && o.TradeID != "" {
		go func(tradeID string) {
			_ = s.payClient().CancelTransaction(tradeID)
		}(o.TradeID)
	}
	_ = s.expireOrder(id)
	http.Redirect(w, r, fmt.Sprintf("/admin/orders/%d", id), http.StatusSeeOther)
}

func (s *Server) handleAdminOrderResend(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
	}
	o, err := s.getOrderByID(id)
	if err == nil && o.Status == "paid" {
		cards, _ := s.getOrderCards(o.ID)
		go s.notifier.SendPaid(o, cards)
	}
	http.Redirect(w, r, fmt.Sprintf("/admin/orders/%d", id), http.StatusSeeOther)
}
