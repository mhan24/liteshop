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
	"strconv"
	"strings"
	"sync"
	"time"

	"shop/internal/bepusdt"
	"shop/internal/config"
	"shop/internal/db"
	"shop/internal/models"
	"shop/internal/notify"
)

type Server struct {
	mux      *http.ServeMux
	db       *sql.DB
	cfg      config.Config
	tpl      *template.Template
	pay      *bepusdt.Client
	notifier *notify.Notifier

	sessMu   sync.Mutex
	sessions map[string]time.Time
}

type ProductView struct {
	Product   models.Product
	Available int
	Reserved  int
	Sold      int
}

type CategoryView struct {
	Name     string
	Products []ProductView
}

type SiteSettings struct {
	Title          string
	Subtitle       string
	Eyebrow        string
	Announcement   string
	SEODescription string
	SEOKeywords    string
	Contact        string
	FriendLinks    string
	Copyright      string
	Privacy        string
	Terms          string
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
		db:       db,
		cfg:      cfg,
		tpl:      tpl,
		pay:      bepusdt.New(cfg.BepusdtBaseURL, cfg.BepusdtToken),
		notifier: notify.New(cfg, db),
		sessions: make(map[string]time.Time),
	}
	mux := http.NewServeMux()
	mux.Handle("GET /static/", http.StripPrefix("/static/", http.FileServer(staticFS())))
	mux.HandleFunc("GET /", s.handleIndex)
	mux.HandleFunc("GET /p/{id}", s.handleProduct)
	mux.HandleFunc("POST /orders", s.handleCreateOrder)
	mux.HandleFunc("GET /privacy", s.handlePrivacy)
	mux.HandleFunc("GET /terms", s.handleTerms)
	mux.HandleFunc("GET /order", s.handleOrderLookup)
	mux.HandleFunc("GET /order/{orderNo}", s.handleOrder)
	mux.HandleFunc("POST /notify/bepusdt", s.handleBepusdtNotify)

	mux.HandleFunc("GET /admin/login", s.handleAdminLogin)
	mux.HandleFunc("POST /admin/login", s.handleAdminLogin)
	mux.Handle("POST /admin/logout", s.requireAdmin(http.HandlerFunc(s.handleAdminLogout)))
	mux.Handle("GET /admin", s.requireAdmin(http.HandlerFunc(s.handleAdminDashboard)))
	mux.Handle("GET /admin/products", s.requireAdmin(http.HandlerFunc(s.handleAdminProducts)))
	mux.Handle("GET /admin/products/new", s.requireAdmin(http.HandlerFunc(s.handleAdminProductNew)))
	mux.Handle("POST /admin/products", s.requireAdmin(http.HandlerFunc(s.handleAdminProductCreate)))
	mux.Handle("GET /admin/products/{id}/edit", s.requireAdmin(http.HandlerFunc(s.handleAdminProductEdit)))
	mux.Handle("POST /admin/products/{id}/edit", s.requireAdmin(http.HandlerFunc(s.handleAdminProductUpdate)))
	mux.Handle("GET /admin/products/{id}/cards", s.requireAdmin(http.HandlerFunc(s.handleAdminCards)))
	mux.Handle("POST /admin/products/{id}/cards", s.requireAdmin(http.HandlerFunc(s.handleAdminCardsImport)))
	mux.Handle("POST /admin/cards/{id}/delete", s.requireAdmin(http.HandlerFunc(s.handleAdminCardDelete)))
	mux.Handle("GET /admin/account", s.requireAdmin(http.HandlerFunc(s.handleAdminAccount)))
	mux.Handle("POST /admin/account", s.requireAdmin(http.HandlerFunc(s.handleAdminAccount)))
	mux.Handle("GET /admin/site", s.requireAdmin(http.HandlerFunc(s.handleAdminSite)))
	mux.Handle("POST /admin/site", s.requireAdmin(http.HandlerFunc(s.handleAdminSite)))
	mux.Handle("GET /admin/settings", s.requireAdmin(http.HandlerFunc(s.handleAdminSettings)))
	mux.Handle("POST /admin/settings", s.requireAdmin(http.HandlerFunc(s.handleAdminSettings)))
	mux.Handle("GET /admin/notify", s.requireAdmin(http.HandlerFunc(s.handleAdminNotify)))
	mux.Handle("POST /admin/notify", s.requireAdmin(http.HandlerFunc(s.handleAdminNotify)))
	mux.Handle("POST /admin/notify/test-email", s.requireAdmin(http.HandlerFunc(s.handleAdminNotifyTestEmail)))
	mux.Handle("POST /admin/notify/test-telegram", s.requireAdmin(http.HandlerFunc(s.handleAdminNotifyTestTelegram)))
	mux.Handle("GET /admin/orders", s.requireAdmin(http.HandlerFunc(s.handleAdminOrders)))
	mux.Handle("GET /admin/orders/{id}", s.requireAdmin(http.HandlerFunc(s.handleAdminOrder)))
	mux.Handle("POST /admin/orders/{id}/expire", s.requireAdmin(http.HandlerFunc(s.handleAdminOrderExpire)))
	mux.Handle("POST /admin/orders/{id}/resend", s.requireAdmin(http.HandlerFunc(s.handleAdminOrderResend)))
	s.mux = mux
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	s.mux.ServeHTTP(w, r)
}

func (s *Server) render(w http.ResponseWriter, status int, name string, data any) {
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
		return config.ParseTradeTypes(value, s.cfg.BepusdtTradeType)
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

func (s *Server) siteSettings() SiteSettings {
	st := SiteSettings{
		Title:          "自动发卡",
		Subtitle:       "选择商品下单，使用加密货币完成支付，支付成功后自动发放卡密。",
		Eyebrow:        "Auto Delivery",
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
	if v := get("site_eyebrow"); v != "" {
		st.Eyebrow = v
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
		st.Copyright = fmt.Sprintf("© %d %s. All rights reserved.", time.Now().Year(), st.Title)
	}
	return st
}

func (s *Server) publicData(r *http.Request, title string) map[string]any {
	st := s.siteSettings()
	return map[string]any{
		"Title":          title,
		"SiteTitle":      st.Title,
		"SiteSubtitle":   st.Subtitle,
		"SiteEyebrow":    st.Eyebrow,
		"Announcement":   st.Announcement,
		"SEODescription": st.SEODescription,
		"SEOKeywords":    st.SEOKeywords,
		"SiteContact":    st.Contact,
		"FriendLinks":    parseFriendLinks(st.FriendLinks),
		"SiteCopyright":  st.Copyright,
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

func (s *Server) handlePrivacy(w http.ResponseWriter, r *http.Request) {
	st := s.siteSettings()
	data := s.publicData(r, "隐私政策")
	data["PageTitle"] = "隐私政策"
	data["PageContent"] = st.Privacy
	s.render(w, 200, "public_page", data)
}

func (s *Server) handleTerms(w http.ResponseWriter, r *http.Request) {
	st := s.siteSettings()
	data := s.publicData(r, "服务条款")
	data["PageTitle"] = "服务条款"
	data["PageContent"] = st.Terms
	s.render(w, 200, "public_page", data)
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
		s.render(w, 200, "admin_site", map[string]any{
			"Title":          "站点设置",
			"SiteTitle":      st.Title,
			"SiteSubtitle":   st.Subtitle,
			"SiteEyebrow":    st.Eyebrow,
			"Announcement":   st.Announcement,
			"SEODescription": st.SEODescription,
			"SEOKeywords":    st.SEOKeywords,
			"SiteContact":    st.Contact,
			"FriendLinks":    st.FriendLinks,
			"SiteCopyright":  st.Copyright,
			"Privacy":        st.Privacy,
			"Terms":          st.Terms,
			"Saved":          r.URL.Query().Get("saved") == "1",
		})
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	values := map[string]string{
		"site_title":        strings.TrimSpace(r.FormValue("site_title")),
		"site_subtitle":     strings.TrimSpace(r.FormValue("site_subtitle")),
		"site_eyebrow":      strings.TrimSpace(r.FormValue("site_eyebrow")),
		"site_announcement": strings.TrimSpace(r.FormValue("site_announcement")),
		"seo_description":   strings.TrimSpace(r.FormValue("seo_description")),
		"seo_keywords":      strings.TrimSpace(r.FormValue("seo_keywords")),
		"site_contact":      strings.TrimSpace(r.FormValue("site_contact")),
		"site_friend_links": strings.TrimSpace(r.FormValue("site_friend_links")),
		"site_copyright":    strings.TrimSpace(r.FormValue("site_copyright")),
		"privacy_policy":    strings.TrimSpace(r.FormValue("privacy_policy")),
		"terms_of_service":  strings.TrimSpace(r.FormValue("terms_of_service")),
	}
	if len([]rune(values["site_title"])) > 80 || len([]rune(values["site_subtitle"])) > 160 || len([]rune(values["site_eyebrow"])) > 40 || len([]rune(values["seo_description"])) > 220 || len([]rune(values["seo_keywords"])) > 220 || len([]rune(values["site_announcement"])) > 4000 || len([]rune(values["site_contact"])) > 1000 || len([]rune(values["site_friend_links"])) > 3000 || len([]rune(values["site_copyright"])) > 200 || len([]rune(values["privacy_policy"])) > 12000 || len([]rune(values["terms_of_service"])) > 12000 {
		s.render(w, 400, "admin_site", map[string]any{"Title": "站点设置", "SiteTitle": values["site_title"], "SiteSubtitle": values["site_subtitle"], "SiteEyebrow": values["site_eyebrow"], "Announcement": values["site_announcement"], "SEODescription": values["seo_description"], "SEOKeywords": values["seo_keywords"], "SiteContact": values["site_contact"], "FriendLinks": values["site_friend_links"], "SiteCopyright": values["site_copyright"], "Privacy": values["privacy_policy"], "Terms": values["terms_of_service"], "Error": "字段长度超出限制。"})
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
		s.render(w, 200, "admin_settings", data(cfg, s.fiat(), strings.Join(s.tradeTypes(), ","), r.URL.Query().Get("saved") == "1", ""))
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
		s.render(w, 400, "admin_settings", d)
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
		s.render(w, 200, "admin_notify", map[string]any{
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
	secret := s.cfg.TurnstileSecret
	if secret == "" {
		return errors.New("TURNSTILE_SECRET is not configured")
	}
	token := strings.TrimSpace(r.FormValue("cf-turnstile-response"))
	if token == "" {
		return errors.New("missing cf-turnstile-response")
	}
	form := url.Values{}
	form.Set("secret", secret)
	form.Set("response", token)
	form.Set("remoteip", clientIP(r))
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
	s.render(w, 200, "public_index", data)
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
		out = append(out, CategoryView{Name: "置顶", Products: pinned})
	}
	for _, name := range categoryOrder {
		var items []ProductView
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
			out = append(out, CategoryView{Name: name, Products: items})
		}
	}
	return out
}

func (s *Server) productPageData(r *http.Request, p models.Product, available int) map[string]any {
	data := s.publicData(r, p.Name)
	data["Product"] = p
	data["Available"] = available
	data["TradeTypes"] = s.tradeTypes()
	data["TurnstileSiteKey"] = s.cfg.TurnstileSiteKey
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
	s.render(w, status, "public_product", data)
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
	s.render(w, 200, "public_product", s.productPageData(r, p, available))
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
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, "人机验证未通过，请完成验证后重试。", http.StatusForbidden)
		return
	}
	if !s.tradeTypeAllowed(tradeType) {
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, "请选择有效的收款币种/网络。", 400)
		return
	}
	if !validEmail(contact) || qty > available {
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, "请填写有效的邮箱地址（用于接收卡密），并确认购买数量不超过库存。", 400)
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
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, "库存不足，请刷新后重试。", 400)
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
		s.renderProductFormError(w, r, p, available, tradeType, contact, qty, "创建支付订单失败："+err.Error(), 502)
		return
	}
	_, _ = s.db.Exec(`UPDATE orders SET trade_id = ?, payment_url = ?, updated_at = ? WHERE id = ?`, tradeID, paymentURL, models.Now(), order.ID)
	http.Redirect(w, r, paymentURL, http.StatusSeeOther)
}

func (s *Server) handleOrderLookup(w http.ResponseWriter, r *http.Request) {
	orderNo := strings.TrimSpace(r.URL.Query().Get("order_no"))
	contact := strings.TrimSpace(r.URL.Query().Get("contact"))
	if orderNo == "" {
		data := s.publicData(r, "订单查询")
		data["Robots"] = "noindex,nofollow"
		data["NoIndex"] = true
		s.render(w, 200, "public_order_lookup", data)
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
	data := s.publicData(r, "订单查询")
	data["Robots"] = "noindex,nofollow"
	data["NoIndex"] = true
	data["OrderNo"] = orderNo
	if contact == "" {
		data["NeedContact"] = true
		s.render(w, 200, "public_order", data)
		return
	}
	if contact != order.BuyerContact {
		data["Error"] = "联系方式与订单不匹配。"
		s.render(w, 403, "public_order", data)
		return
	}
	data["Order"] = order
	if order.Status == "paid" {
		cards, _ := s.getOrderCards(order.ID)
		data["Cards"] = cards
	}
	s.render(w, 200, "public_order", data)
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
		order, cards, changed, err := s.markPaid(params)
		if err != nil {
			log.Printf("mark paid %s: %v", params["order_id"], err)
		}
		if changed {
			go s.notifier.SendPaid(order, cards)
		}
	case "3":
		if err := s.markExpiredByOrderNo(params["order_id"]); err != nil {
			log.Printf("mark expired %s: %v", params["order_id"], err)
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
	rows, err := s.db.Query(`SELECT p.id, p.name, p.description, p.price_cents, p.status, p.category, p.sort_order, p.is_pinned, p.created_at, p.updated_at,
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'available'),
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'reserved'),
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'sold')
		FROM products p ` + where + ` ORDER BY p.is_pinned DESC, p.sort_order ASC, p.id DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []ProductView
	for rows.Next() {
		var v ProductView
		if err := rows.Scan(&v.Product.ID, &v.Product.Name, &v.Product.Description, &v.Product.PriceCents, &v.Product.Status, &v.Product.Category, &v.Product.SortOrder, &v.Product.IsPinned, &v.Product.CreatedAt, &v.Product.UpdatedAt, &v.Available, &v.Reserved, &v.Sold); err != nil {
			return nil, err
		}
		out = append(out, v)
	}
	return out, rows.Err()
}

func (s *Server) getProductView(id int64) (models.Product, int, error) {
	var p models.Product
	var available int
	err := s.db.QueryRow(`SELECT p.id, p.name, p.description, p.price_cents, p.status, p.category, p.sort_order, p.is_pinned, p.created_at, p.updated_at,
		(SELECT COUNT(1) FROM cards c WHERE c.product_id = p.id AND c.status = 'available')
		FROM products p WHERE p.id = ?`, id).Scan(&p.ID, &p.Name, &p.Description, &p.PriceCents, &p.Status, &p.Category, &p.SortOrder, &p.IsPinned, &p.CreatedAt, &p.UpdatedAt, &available)
	return p, available, err
}

func (s *Server) createPendingOrder(order *models.Order) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	res, err := tx.Exec(`INSERT INTO orders(order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, created_at, updated_at)
		VALUES(?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`, order.OrderNo, order.ProductID, order.ProductName, order.Qty, order.AmountCents, order.Fiat, order.TradeType, order.BuyerContact, order.CreatedAt, order.UpdatedAt)
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
		if _, err := tx.Exec(`UPDATE cards SET status = 'reserved', order_id = ?, updated_at = ? WHERE id = ? AND status = 'available'`, order.ID, models.Now(), id); err != nil {
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
	if _, err := tx.Exec(`UPDATE cards SET status = 'available', order_id = 0, updated_at = ? WHERE order_id = ? AND status = 'reserved'`, models.Now(), orderID); err != nil {
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
	rows, err := s.db.Query(`SELECT id, product_id, order_id, content, status, created_at, updated_at, sold_at FROM cards WHERE order_id = ? ORDER BY id`, orderID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []models.Card
	for rows.Next() {
		var c models.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.OrderID, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Server) markPaid(params map[string]string) (models.Order, []models.Card, bool, error) {
	orderNo := params["order_id"]
	tx, err := s.db.Begin()
	if err != nil {
		return models.Order{}, nil, false, err
	}
	defer tx.Rollback()
	var o models.Order
	err = tx.QueryRow(`SELECT id, order_no, product_id, product_name, qty, amount_cents, fiat, trade_type, buyer_contact, status, trade_id, payment_url, block_transaction_id, created_at, updated_at, paid_at FROM orders WHERE order_no = ?`, orderNo).Scan(&o.ID, &o.OrderNo, &o.ProductID, &o.ProductName, &o.Qty, &o.AmountCents, &o.Fiat, &o.TradeType, &o.BuyerContact, &o.Status, &o.TradeID, &o.PaymentURL, &o.BlockTransactionID, &o.CreatedAt, &o.UpdatedAt, &o.PaidAt)
	if err != nil {
		return models.Order{}, nil, false, err
	}
	if o.Status == "paid" {
		if err := tx.Commit(); err != nil {
			return models.Order{}, nil, false, err
		}
		cards, _ := s.getOrderCards(o.ID)
		return o, cards, false, nil
	}
	if o.Status != "pending" {
		return o, nil, false, tx.Commit()
	}
	now := models.Now()
	res, err := tx.Exec(`UPDATE orders SET status = 'paid', trade_id = ?, block_transaction_id = ?, paid_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'`, params["trade_id"], params["block_transaction_id"], now, now, o.ID)
	if err != nil {
		return models.Order{}, nil, false, err
	}
	affected, _ := res.RowsAffected()
	if affected == 0 {
		return o, nil, false, tx.Commit()
	}
	if _, err := tx.Exec(`UPDATE cards SET status = 'sold', sold_at = ?, updated_at = ? WHERE order_id = ? AND status = 'reserved'`, now, now, o.ID); err != nil {
		return models.Order{}, nil, false, err
	}
	if err := tx.Commit(); err != nil {
		return models.Order{}, nil, false, err
	}
	o.Status = "paid"
	o.TradeID = params["trade_id"]
	o.BlockTransactionID = params["block_transaction_id"]
	o.PaidAt = now
	cards, _ := s.getOrderCards(o.ID)
	return o, cards, true, nil
}

func (s *Server) markExpiredByOrderNo(orderNo string) error {
	o, err := s.getOrderByNo(orderNo)
	if err != nil {
		return err
	}
	return s.expireOrder(o.ID)
}

func (s *Server) expireOrder(orderID int64) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`UPDATE cards SET status = 'available', order_id = 0, updated_at = ? WHERE order_id = ? AND status = 'reserved'`, models.Now(), orderID); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE orders SET status = 'expired', updated_at = ? WHERE id = ? AND status = 'pending'`, models.Now(), orderID); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Server) handleAdminLogin(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodGet {
		s.render(w, 200, "admin_login", map[string]any{"Title": "后台登录"})
		return
	}
	if err := r.ParseForm(); err != nil {
		http.Error(w, "bad form", 400)
		return
	}
	username := strings.TrimSpace(r.FormValue("username"))
	password := r.FormValue("password")
	var hash string
	err := s.db.QueryRow(`SELECT password_hash FROM admins WHERE id = 1 AND username = ?`, username).Scan(&hash)
	if err != nil || !models.CheckPassword(password, hash) {
		s.render(w, 403, "admin_login", map[string]any{"Title": "后台登录", "Error": "用户名或密码错误。"})
		return
	}
	id := models.RandomToken(24)
	s.sessMu.Lock()
	s.sessions[id] = time.Now().Add(12 * time.Hour)
	s.sessMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: id + "." + s.signSession(id), Path: "/", HttpOnly: true, SameSite: http.SameSiteLaxMode, Expires: time.Now().Add(12 * time.Hour)})
	http.Redirect(w, r, "/admin", http.StatusSeeOther)
}

func (s *Server) handleAdminAccount(w http.ResponseWriter, r *http.Request) {
	var currentUsername string
	_ = s.db.QueryRow(`SELECT username FROM admins WHERE id = 1`).Scan(&currentUsername)
	if r.Method == http.MethodGet {
		s.render(w, 200, "admin_account", map[string]any{"Title": "账号设置", "Username": currentUsername, "Saved": r.URL.Query().Get("saved") == "1"})
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
		s.render(w, 400, "admin_account", map[string]any{"Title": "账号设置", "Username": username, "Error": msg})
	}
	var hash string
	if err := s.db.QueryRow(`SELECT password_hash FROM admins WHERE id = 1`).Scan(&hash); err != nil || !models.CheckPassword(currentPassword, hash) {
		renderErr("当前密码错误。")
		return
	}
	if username == "" {
		renderErr("用户名不能为空。")
		return
	}
	if newPassword != "" {
		if len(newPassword) < 8 {
			renderErr("新密码长度至少 8 位。")
			return
		}
		if newPassword != confirmPassword {
			renderErr("两次输入的新密码不一致。")
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

func (s *Server) signSession(id string) string {
	h := hmac.New(sha256.New, []byte(s.cfg.SessionSecret))
	h.Write([]byte(id))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

func (s *Server) isAdmin(r *http.Request) bool {
	id, ok := s.sessionID(r)
	if !ok {
		return false
	}
	s.sessMu.Lock()
	exp, ok := s.sessions[id]
	if ok && time.Now().Before(exp) {
		s.sessions[id] = time.Now().Add(12 * time.Hour)
	} else {
		delete(s.sessions, id)
		ok = false
	}
	s.sessMu.Unlock()
	return ok
}

func (s *Server) handleAdminDashboard(w http.ResponseWriter, r *http.Request) {
	var products, availableCards, pendingOrders, paidOrders int
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM products`).Scan(&products)
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM cards WHERE status = 'available'`).Scan(&availableCards)
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status = 'pending'`).Scan(&pendingOrders)
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM orders WHERE status = 'paid'`).Scan(&paidOrders)
	s.render(w, 200, "admin_dashboard", map[string]any{"Title": "后台首页", "Products": products, "AvailableCards": availableCards, "PendingOrders": pendingOrders, "PaidOrders": paidOrders})
}

func (s *Server) handleAdminProducts(w http.ResponseWriter, r *http.Request) {
	products, err := s.listProductViews(false)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	s.render(w, 200, "admin_products", map[string]any{"Title": "商品管理", "Products": products})
}

func (s *Server) handleAdminProductNew(w http.ResponseWriter, r *http.Request) {
	s.render(w, 200, "admin_product_form", map[string]any{"Title": "新建商品", "Product": models.Product{Status: "active"}})
}

func (s *Server) handleAdminProductCreate(w http.ResponseWriter, r *http.Request) {
	p, err := s.productFromForm(r)
	if err != nil {
		s.render(w, 400, "admin_product_form", map[string]any{"Title": "新建商品", "Product": p, "Error": err.Error()})
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
	s.render(w, 200, "admin_product_form", map[string]any{"Title": "编辑商品", "Product": p})
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
		s.render(w, 400, "admin_product_form", map[string]any{"Title": "编辑商品", "Product": p, "Error": err.Error()})
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
		return models.Product{}, errors.New("商品名称不能为空")
	}
	price, err := models.CentsFromYuan(strings.TrimSpace(r.FormValue("price")))
	if err != nil || price <= 0 {
		return models.Product{}, errors.New("价格必须是大于 0 的数字")
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
	rows, err := s.db.Query(`SELECT id, product_id, order_id, content, status, created_at, updated_at, sold_at FROM cards WHERE product_id = ? ORDER BY id DESC LIMIT 500`, id)
	if err != nil {
		http.Error(w, err.Error(), 500)
		return
	}
	defer rows.Close()
	var cards []models.Card
	for rows.Next() {
		var c models.Card
		if err := rows.Scan(&c.ID, &c.ProductID, &c.OrderID, &c.Content, &c.Status, &c.CreatedAt, &c.UpdatedAt, &c.SoldAt); err != nil {
			http.Error(w, err.Error(), 500)
			return
		}
		cards = append(cards, c)
	}
	s.render(w, 200, "admin_cards", map[string]any{"Title": "卡密管理", "Product": p, "Available": available, "Cards": cards})
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
	s.render(w, 200, "admin_orders", map[string]any{"Title": "订单管理", "Orders": orders})
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
	s.render(w, 200, "admin_order", map[string]any{"Title": "订单详情", "Order": o, "Cards": cards})
}

func (s *Server) handleAdminOrderExpire(w http.ResponseWriter, r *http.Request) {
	id, err := pathID(r, "id")
	if err != nil {
		http.NotFound(w, r)
		return
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
