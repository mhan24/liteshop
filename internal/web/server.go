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
	"shop/internal/product"
	"shop/internal/security"
)

type Server struct {
	mux       *http.ServeMux
	db        *sql.DB
	cfg       config.Config
	tpl       *template.Template
	pay       *bepusdt.Client
	notifier  *notify.Notifier
	orders    *order.Service
	products  *product.Service
	dbPath    string
	startTime time.Time

	sessMu   sync.Mutex
	sessions map[string]sessionInfo

	limitersMu sync.Mutex
	limiters   map[string]*RateLimiter

	totpCipher *security.Cipher
}

type sessionInfo struct {
	AdminID int64
	Expiry  time.Time
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
	StockDisplay   string
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
		limiters:  make(map[string]*RateLimiter),
	}
	s.totpCipher = security.NewCipher(s.sessionSecret())
	s.orders = order.NewService(
		order.NewRepositoryWithTZ(db, models.LocationFromTimezone(s.siteSettings().Timezone)),
		s.payClient,
		s.paymentConfigForService,
	)
	s.orders.SendPaid = s.notifier.SendPaid
	s.products = product.NewService(product.NewRepository(db))
	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-store")
		writeJSON(w, 200, map[string]any{"ok": true})
	})
	mux.HandleFunc("POST "+s.bepusdtNotifyPath(), s.handleBepusdtNotify)
	s.registerAPI(mux)
	s.registerDocs(mux)
	mux.Handle("GET /admin/assets/", http.StripPrefix("/admin", http.FileServer(adminAssetsFS())))
	mux.HandleFunc("GET /admin", s.adminIndex)
	mux.HandleFunc("GET /admin/{path...}", s.adminIndex)
	s.mux = mux
	// 定期清理过期 session（含 2FA 待验证 token）与限流器，防止内存无限增长
	go func() {
		ticker := time.NewTicker(5 * time.Minute)
		defer ticker.Stop()
		for range ticker.C {
			s.sessMu.Lock()
			now := time.Now()
			for k, v := range s.sessions {
				if now.After(v.Expiry) {
					delete(s.sessions, k)
				}
			}
			s.sessMu.Unlock()
			s.cleanupLimiters()
			// 补偿清理超时未支付的 created/waiting 订单（释放卡密+回滚券）
			if n, err := s.orders.ExpireStale(s.paymentConfigForService().TimeoutSec); err != nil {
				log.Printf("expire stale orders: %v", err)
			} else if n > 0 {
				log.Printf("expired %d stale orders", n)
			}
		}
	}()
	return s, nil
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
	s.mux.ServeHTTP(w, r)
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
		// 过滤历史遗留的非法值（旧版本可绕过校验保存），避免前台选项与接口校验不一致。
		var out []string
		for _, t := range config.ParseTradeTypes(value) {
			if validTradeType(t) {
				out = append(out, t)
			}
		}
		if len(out) > 0 {
			return out
		}
	}
	return s.cfg.BepusdtTradeTypes
}

func (s *Server) fiat() string {
	value, err := db.GetSetting(s.db, "bepusdt_fiat")
	if err == nil && strings.TrimSpace(value) != "" {
		return strings.ToUpper(strings.TrimSpace(value))
	}
	// 兼容旧版本误存到 "fiat" 键的配置（此前保存键名错误导致不生效）。
	if legacy, err := db.GetSetting(s.db, "fiat"); err == nil && strings.TrimSpace(legacy) != "" {
		return strings.ToUpper(strings.TrimSpace(legacy))
	}
	return s.cfg.BepusdtFiat
}

// bepusdtNotifyPath 返回 BEpusdt 回调路径（可配置，默认 /notify/bepusdt）。
// 仅接受安全字符且不与已有路由冲突，非法配置回退默认路径，防止 ServeMux panic。
func (s *Server) bepusdtNotifyPath() string {
	if v := strings.TrimSpace(mustGetSetting(s, "bepusdt_notify_path")); v != "" {
		if !strings.HasPrefix(v, "/") {
			v = "/" + v
		}
		if reNotifyPath.MatchString(v) && !notifyPathConflicts(v) {
			return v
		}
	}
	return "/notify/bepusdt"
}

var reNotifyPath = regexp.MustCompile(`^/[a-zA-Z0-9_-]+(/[a-zA-Z0-9_-]+)*$`)

// notifyPathConflicts 拒绝与已注册路由冲突的路径（避免 ServeMux 注册 panic）。
func notifyPathConflicts(v string) bool {
	return v == "/health" || v == "/docs" || v == "/setup" ||
		strings.HasPrefix(v, "/api") || strings.HasPrefix(v, "/admin")
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
		// 使用同一回调路径（可配置），避免自定义路径下回调 404
		cfg.NotifyURL = cfg.PublicBaseURL + s.bepusdtNotifyPath()
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
	st.StockDisplay = firstNonEmpty(get("stock_display_mode"), "exact")
	return st
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
	// 优先信任 CF-Connecting-IP（由 Cloudflare 设置，站点经 CF 时不可伪造）。
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" && net.ParseIP(ip) != nil {
		return ip
	}
	// 否则取 X-Forwarded-For 最右侧的合法 IP：该条目由离服务最近的代理（如 Caddy）追加，
	// 客户端无法通过伪造头部改变已存在条目的位置，避免"取第一个值"导致的限流绕过。
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			ip := strings.TrimSpace(parts[i])
			if ip != "" && net.ParseIP(ip) != nil {
				return ip
			}
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
		log.Printf("bepusdt notify verify failed: %v (body %d bytes)", err, len(body))
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

// getProductViewBySlug 按 slug 查找商品。

// markPaid 处理支付回调：waiting_payment -> paid，并记录事件日志。

// deliverOrder 执行发卡（释放卡密为 sold），并在成功后推进到 delivered。
// 返回卡密与是否发生变更。

// cancelOrExpire 释放预留卡密并将订单置为取消/过期，记录日志。

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

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, adminID int64) {
	// 生产部署由 Caddy/Cloudflare 终止 TLS，Go 侧 r.TLS 恒为 nil，
	// 需根据 X-Forwarded-Proto 判断客户端是否为 HTTPS，否则 Cookie 不带 Secure。
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	id := models.RandomToken(24)
	s.sessMu.Lock()
	s.sessions[id] = sessionInfo{AdminID: adminID, Expiry: time.Now().Add(12 * time.Hour)}
	s.sessMu.Unlock()
	http.SetCookie(w, &http.Cookie{Name: "shop_session", Value: id + "." + s.signSession(id), Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: time.Now().Add(12 * time.Hour)})
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
