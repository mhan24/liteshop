package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	admindomain "shop/internal/modules/admin/domain"
	productdomain "shop/internal/modules/product/domain"
	"shop/internal/shared/idgen"
	"strconv"
	"strings"
	"sync"
	"time"

	notify "shop/internal/integrations/notification"
	"shop/internal/integrations/payment/bepusdt"
	"shop/internal/integrations/payment/hashpay"
	"shop/internal/integrations/turnstile"
	platformevents "shop/internal/platform/events"
	"shop/internal/platform/httpserver"

	adminapp "shop/internal/modules/admin/application"

	adminsqlite "shop/internal/modules/admin/repository/sqlite"

	auditapp "shop/internal/modules/audit/application"

	auditsqlite "shop/internal/modules/audit/repository/sqlite"

	couponapp "shop/internal/modules/coupon/application"

	couponsqlite "shop/internal/modules/coupon/repository/sqlite"

	inventoryapp "shop/internal/modules/inventory/application"

	inventorysqlite "shop/internal/modules/inventory/repository/sqlite"

	orderapp "shop/internal/modules/order/application"

	ordersqlite "shop/internal/modules/order/repository/sqlite"

	orderhttp "shop/internal/modules/order/transport/http"

	adminhttp "shop/internal/modules/admin/transport/http"
	audithttp "shop/internal/modules/audit/transport/http"
	couponhttp "shop/internal/modules/coupon/transport/http"
	inventoryhttp "shop/internal/modules/inventory/transport/http"
	producthttp "shop/internal/modules/product/transport/http"
	settingshttp "shop/internal/modules/settings/transport/http"

	productapp "shop/internal/modules/product/application"

	productsqlite "shop/internal/modules/product/repository/sqlite"

	settingsapp "shop/internal/modules/settings/application"

	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	"shop/internal/platform/config"
	"shop/internal/platform/logging"

	"shop/internal/platform/scheduler/jobs"
	"shop/internal/platform/version"
)

// 编译期断言：SQLite 实现满足各模块端口接口。
var (
	_ orderapp.OrderRepository     = (*ordersqlite.OrderRepository)(nil)
	_ productapp.ProductRepository = (*productsqlite.ProductRepository)(nil)
	_ inventoryapp.KeyRepository   = (*inventorysqlite.KeyRepository)(nil)
	_ settingsapp.SettingsStore    = (*settingssqlite.Store)(nil)
	_ adminapp.AdminStore          = (*adminsqlite.Store)(nil)
	_ adminapp.JobsStore           = (*adminsqlite.Store)(nil)
	_ adminapp.StatsStore          = (*adminsqlite.Store)(nil)
	_ couponapp.CouponStore        = (*couponsqlite.CouponRepository)(nil)
	_ auditapp.AuditStore          = (*auditsqlite.AuditRepository)(nil)
)

type Server struct {
	mux       *http.ServeMux
	db        *sql.DB
	cfg       config.Config
	bus       *jobs.Bus
	notifier  *notify.Notifier
	orders    *orderapp.OrderService
	products  *productapp.ProductService
	inventory *inventoryapp.InventoryService
	coupons   *couponapp.CouponService
	settings  *settingsapp.SettingsService
	admin     *adminapp.AdminService
	audit     *auditapp.AuditService
	notifySvc *settingsapp.NotifyService
	stats     *adminapp.StatsService
	jobsSvc   *adminapp.JobsService
	dbPath    string
	startTime time.Time

	sessionKey string

	limitersMu sync.Mutex
	limiters   map[string]*RateLimiter

	linkMu   sync.Mutex
	linkSent map[string]int64 // 订单查看链接邮件冷却（按邮箱）
}

// registrar 组合根的路由注册器（携带 app 中间件：限流 / 鉴权 / CSRF）。
type registrar struct {
	mux *http.ServeMux
	s   *Server
}

func (r *registrar) Public(method, path string, limit int, h http.HandlerFunc) {
	if limit > 0 {
		h = r.s.rateLimitMiddleware(path, limit, h)
	}
	r.mux.HandleFunc(method+" "+path, h)
}

func (r *registrar) Admin(method, path string, minRole string, h http.HandlerFunc) {
	r.mux.Handle(method+" "+path, r.s.requireRole(minRole, http.HandlerFunc(h)))
}

// registerModuleRoutes 注册各模块 HTTP 路由（模块 transport 只依赖应用用例）。
func (s *Server) registerModuleRoutes(mux *http.ServeMux) {
	reg := &registrar{mux: mux, s: s}
	orderhttp.Register(reg, orderhttp.NewHandlers(orderhttp.Deps{
		Orders: s.orders, Products: s.products, Settings: s.settings, Notify: s.notifySvc,
		Audit: s.recordAudit, ClientIP: clientIP,
		CurrentRole: func(r *http.Request) string {
			_, role, _ := s.currentSession(r)
			return role
		},
	}))
	producthttp.Register(reg, producthttp.NewHandlers(producthttp.Deps{
		Products: s.products, Settings: s.settings, Audit: s.recordAudit,
		CurrentRole: func(r *http.Request) string {
			_, role, _ := s.currentSession(r)
			return role
		},
	}))
	inventoryhttp.Register(reg, inventoryhttp.NewHandlers(inventoryhttp.Deps{
		Inventory: s.inventory, Products: s.products, Audit: s.recordAudit,
	}))
	couponhttp.Register(reg, couponhttp.NewHandlers(couponhttp.Deps{
		Coupons: s.coupons, Audit: s.recordAudit,
	}))
	settingshttp.Register(reg, settingshttp.NewHandlers(settingshttp.Deps{
		Settings: s.settings, Admin: s.admin, Notify: s.notifySvc, Audit: s.recordAudit,
		ResetLimiters: s.resetLimiters,
	}))
	adminhttp.Register(reg, adminhttp.NewHandlers(adminhttp.Deps{
		Admin: s.admin, AuditService: s.audit, Stats: s.stats, Jobs: s.jobsSvc,
		Settings: s.settings, Audit: s.recordAudit, ClientIP: clientIP,
		SessionID:        s.sessionID,
		CurrentSession:   s.currentSession,
		CurrentRole:      func(r *http.Request) string {
			_, role, _ := s.currentSession(r)
			return role
		},
		CurrentAdminID:   s.currentAdminID,
		CurrentAdminName: s.currentAdminName,
		StartSession:     s.startSession,
		DBPath:           s.dbPath,
		StartTime:        s.startTime,
	}))
	audithttp.Register(reg, audithttp.NewHandlers(audithttp.Deps{
		AuditService: s.audit,
	}))
}

// logStartupInfo 输出结构化启动横幅（版本 / 数据库 / 支付 / 监听地址）。
func (s *Server) logStartupInfo() {
	payCfg := s.settings.PaymentConfig()
	paymentStatus := paymentStatusFor(payCfg)
	logging.App().Sugar().Infof("LiteShop %s", version.String())
	logging.App().Sugar().Infof("database: ok (path=%s)", s.dbPath)
	logging.App().Sugar().Infof("payment: %s (gateways=%s)", paymentStatus, strings.Join(payCfg.EnabledGateways, ","))
	logging.App().Sugar().Infof("listen: %s", s.cfg.ListenAddr)
	logging.App().Sugar().Infof("admin entry: %s/admin", s.cfg.PublicBaseURL)
	logging.App().Sugar().Infof("notify url: %s", payCfg.NotifyURL)
	logging.App().Sugar().Warn("security: session master key is stored in the database (plaintext) — protect DB access; server-local key file is planned via a future settings migration")
}

// notifyEventConsumer 模板事件消费者（订单创建/支付成功/发货/低库存 → 通知模板）。
func notifyEventConsumer(notifier *notify.Notifier) func(platformevents.Event) {
	return func(e platformevents.Event) {
		switch ev := e.(type) {
		case orderapp.OrderCreatedEvent:
			payload := notifier.OrderPayload(notify.EventOrderCreated, ev.Order, nil, nil)
			notifier.Notify(notify.EventOrderCreated, payload)
		case orderapp.OrderPaidEvent:
			payload := notifier.OrderPayload(notify.EventPaymentSuccess, ev.Order, nil, nil)
			delete(payload, "contact") // 买家邮件由 SendPaid 发送，避免重复
			notifier.Notify(notify.EventPaymentSuccess, payload)
		case orderapp.OrderDeliveredEvent:
			payload := notifier.OrderPayload(notify.EventDelivered, ev.Order, ev.Cards, nil)
			delete(payload, "contact")
			notifier.Notify(notify.EventDelivered, payload)
		case orderapp.LowStockEvent:
			notifier.NotifyLowStock(ev.ProductID, ev.ProductName, ev.Available, ev.Threshold)
		}
	}
}

// notifyOutboxConsumer 同步完成通知消费者；失败通过 panic 交给同步 Fanout 转成错误。
func notifyOutboxConsumer(notifier *notify.Notifier) func(platformevents.Event) {
	return func(e platformevents.Event) {
		var event string
		var payload map[string]string
		switch ev := e.(type) {
		case orderapp.OrderPaidEvent:
			event = notify.EventPaymentSuccess
			payload = notifier.OrderPayload(event, ev.Order, nil, nil)
			delete(payload, "contact")
		case orderapp.OrderDeliveredEvent:
			event = notify.EventDelivered
			payload = notifier.OrderPayload(event, ev.Order, ev.Cards, nil)
			delete(payload, "contact")
		default:
			return
		}
		if err := notifier.NotifySync(event, payload); err != nil {
			panic(err)
		}
	}
}

// mailEventConsumer 买家发卡邮件消费者（OrderPaid → SendPaid，独立失败不影响其他消费者）。
func mailEventConsumer(notifier *notify.Notifier) func(platformevents.Event) {
	return func(e platformevents.Event) {
		if ev, ok := e.(orderapp.OrderPaidEvent); ok {
			// 人工手动交付订单：支付成功不随支付发卡邮件，发货内容由管理员发货时发送。
			if ev.Order.DeliveryType == productdomain.DeliveryTypeManual {
				return
			}
			notifier.SendPaid(ev.Order, ev.Cards)
		}
	}
}

// mailOutboxConsumer 同步完成买家发卡通知，再允许 Outbox 确认事件。
func mailOutboxConsumer(notifier *notify.Notifier) func(platformevents.Event) {
	return func(e platformevents.Event) {
		switch ev := e.(type) {
		case orderapp.OrderPaidEvent:
			if ev.Order.DeliveryType != productdomain.DeliveryTypeManual {
				notifier.SendPaidSync(ev.Order, ev.Cards)
			}
		case orderapp.OrderDeliveredEvent:
			if ev.Order.DeliveryType == productdomain.DeliveryTypeManual {
				notifier.SendPaidSync(ev.Order, nil)
			}
		}
	}
}

// handleHealth 组件级健康检查：数据库连通性 + 支付网关配置状态。
// DB 故障返回 503；支付未配置视为 degraded（仍 200，便于部署/监控识别状态）。
func (s *Server) handleHealth(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Cache-Control", "no-store")
	dbStatus := "ok"
	if err := s.db.Ping(); err != nil {
		dbStatus = "fail"
	}
	status := http.StatusOK
	if dbStatus != "ok" {
		status = http.StatusServiceUnavailable
	}
	if !s.isAdmin(r) {
		writeJSON(w, status, map[string]any{"ok": dbStatus == "ok"})
		return
	}
	payCfg := s.settings.PaymentConfig()
	paymentStatus := paymentStatusFor(payCfg)
	var dbSize int64
	if st, err := os.Stat(s.dbPath); err == nil {
		dbSize = st.Size()
	}
	health, err := s.stats.Health()
	if err != nil {
		writeInternalError(w, err)
		return
	}
	backupFile, backupMod, hasBackup := latestBackupFile(s.dbPath)
	lastBackup := map[string]any{"file": "", "modified": int64(0)}
	if hasBackup {
		lastBackup = map[string]any{"file": backupFile, "modified": backupMod}
	}
	body := map[string]any{
		"ok":             dbStatus == "ok",
		"app":            "LiteShop",
		"version":        version.Version,
		"build":          version.String(),
		"config_version": s.settings.ConfigVersion(),
		"uptime_sec":     int64(time.Since(s.startTime).Seconds()),
		"database": map[string]any{
			"status":            dbStatus,
			"size_bytes":        dbSize,
			"migration_version": health.SchemaVersion,
			"last_backup":       lastBackup,
			"integrity":         map[bool]string{true: "ok", false: "error"}[health.IntegrityOK],
		},
		"jobs": map[string]any{
			"queue_size":      busQueueSize(s.bus),
			"mail_queue_size": health.MailQueuePending,
			"last_success":    health.LastJobSuccess,
		},
		"payment": paymentStatus,
	}
	writeJSON(w, status, body)
}

// busQueueSize 返回任务总线积压数（测试/降级场景下 bus 可能为 nil）。
func busQueueSize(b *jobs.Bus) int {
	if b == nil {
		return 0
	}
	return b.QueueSize()
}

// gatewayConfigured 判断指定网关凭据是否齐全。
func gatewayConfigured(cfg config.Config, gateway string) bool {
	if gateway == "hashpay" {
		return cfg.HashPayMerchantID != "" && cfg.HashPayPrivateKey != ""
	}
	return cfg.BepusdtBaseURL != "" && cfg.BepusdtToken != ""
}

// paymentStatusFor 只要任一启用网关已配置即为 ok（双网关并存）。
func paymentStatusFor(cfg config.Config) string {
	for _, g := range cfg.EnabledGateways {
		if gatewayConfigured(cfg, g) {
			return "ok"
		}
	}
	return "not_configured"
}

// latestBackupFile 返回备份目录（data/backups）中最新的 shop-*.db 备份。
func latestBackupFile(dbPath string) (string, int64, bool) {
	dir := filepath.Join(filepath.Dir(dbPath), "backups")
	entries, err := os.ReadDir(dir)
	if err != nil {
		return "", 0, false
	}
	var best string
	var bestMod int64
	for _, e := range entries {
		if e.IsDir() || !strings.HasPrefix(e.Name(), "shop-") || !strings.HasSuffix(e.Name(), ".db") {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		if info.ModTime().Unix() > bestMod {
			best = e.Name()
			bestMod = info.ModTime().Unix()
		}
	}
	if best == "" {
		return "", 0, false
	}
	return best, bestMod, true
}

// cleanupMemory 清理进程内状态（2FA 待验证、链接冷却、限流器）。
func (s *Server) cleanupMemory() {
	// 2FA 待验证令牌与登录锁定由 AdminService 管理，此处仅清理限流器与邮件冷却。
	s.admin.ClearPendingTotps()
	s.admin.CleanupStaleLoginFails(time.Now().Unix())
	cutoff := time.Now().Add(-10 * time.Minute).Unix()
	s.linkMu.Lock()
	for k, v := range s.linkSent {
		if v < cutoff {
			delete(s.linkSent, k)
		}
	}
	s.linkMu.Unlock()
	s.cleanupLimiters()
}

func (s *Server) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("X-Frame-Options", "DENY")
	w.Header().Set("Referrer-Policy", "strict-origin-when-cross-origin")
	w.Header().Set("Permissions-Policy", "geolocation=(), microphone=(), camera=()")
	// HSTS：仅在 HTTPS 请求时下发（生产由 Caddy/Cloudflare 终止 TLS，以 X-Forwarded-Proto 判断）。
	if requestIsHTTPS(r) {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	}
	// 关联 ID：一次请求一个 request_id，贯穿 app/payment/security 日志与响应头。
	requestID := idgen.RandomToken(16)
	w.Header().Set("X-Request-ID", requestID)
	ctx := logging.WithRequestID(r.Context(), requestID)
	rec := httpserver.NewStatusRecorder(w)
	start := time.Now()
	// 管理后台 SPA 的 CSP（/docs 依赖 CDN 脚本，不在此范围）。
	if strings.HasPrefix(r.URL.Path, "/admin") {
		// script-src 需 'unsafe-eval'（vue-i18n 消息编译使用 new Function）与 'unsafe-inline'
		// （站点位于 Cloudflare 之后，边缘会向 HTML 注入 JS 检测内联脚本，内容含每次请求
		// 变化的 ray ID，无法用固定 hash 放行）；static.cloudflareinsights.com 为
		// Cloudflare Web Analytics beacon（与前台策略保持一致）。
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self' 'unsafe-eval' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self' https://static.cloudflareinsights.com https://cloudflareinsights.com; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
	}
	s.mux.ServeHTTP(rec, r.WithContext(ctx))
	logging.App().Sugar().Infow("http request",
		"request_id", requestID,
		"method", r.Method,
		"path", r.URL.Path,
		"status", rec.Status(),
		"duration_ms", time.Since(start).Milliseconds(),
	)
}

func pathID(r *http.Request, name string) (int64, error) {
	return strconv.ParseInt(r.PathValue(name), 10, 64)
}

// paymentGateway 按名称构造支付网关（每次调用读取最新配置）。
func (s *Server) paymentGateway(gateway string) orderapp.PaymentGateway {
	cfg := s.settings.PaymentConfig()
	if gateway == "hashpay" {
		return hashpay.NewHashPay(cfg.HashPayBaseURL, cfg.HashPayMerchantID, cfg.HashPayPrivateKey, cfg.HashPayCurrency)
	}
	return bepusdt.NewClient(cfg.BepusdtBaseURL, cfg.BepusdtToken)
}

func (s *Server) verifyTurnstileToken(token, remoteIP, host string) error {
	return turnstile.Verify(s.settings.TurnstileSecret(), token, remoteIP, host)
}

func clientIP(r *http.Request) string {
	// 仅当对端确为 Cloudflare 边缘时才信任 CF-Connecting-IP：
	// 直连（绕过 CF）的客户端可伪造该头，若无条件信任会绕过所有按 IP 限流。
	peer := net.ParseIP(remoteIP(r))
	if peer != nil && isCloudflareIP(peer) {
		if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" && net.ParseIP(ip) != nil {
			return ip
		}
	}
	// 只信任本机反向代理追加的 X-Forwarded-For。公网直连时该请求头完全由客户端控制。
	if peer != nil && peer.IsLoopback() {
		xff := r.Header.Get("X-Forwarded-For")
		parts := strings.Split(xff, ",")
		for i := len(parts) - 1; i >= 0; i-- {
			ip := strings.TrimSpace(parts[i])
			parsed := net.ParseIP(ip)
			if parsed != nil {
				// Cloudflare → Caddy → Go：最右侧是 Caddy 看到的 CF 边缘地址，
				// 此时 CF-Connecting-IP 仍由可信 CF 生成，可恢复真实访客地址。
				if isCloudflareIP(parsed) {
					if cfIP := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); net.ParseIP(cfIP) != nil {
						return cfIP
					}
				}
				return ip
			}
		}
	}
	return remoteIP(r)
}

func requestIsHTTPS(r *http.Request) bool {
	if r.TLS != nil {
		return true
	}
	peer := net.ParseIP(remoteIP(r))
	return peer != nil && (peer.IsLoopback() || isCloudflareIP(peer)) &&
		strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
}

// remoteIP 返回 TCP 对端 IP 字符串（去除端口）。
func remoteIP(r *http.Request) string {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	if ip := net.ParseIP(host); ip != nil {
		return ip.String()
	}
	return host
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

// handleHashPayNotify 处理 HashPay 回调（RSA-OAEP-256+A256GCM 加密信封）。
// HashPay 会向商户后台配置的 callback 地址投递订单状态变化：
// paid → 确认支付并发卡；expired/invalid → 关闭订单释放库存。

func (s *Server) handlePaymentNotify(w http.ResponseWriter, r *http.Request) {
	if s.settings.PaymentConfig().BepusdtToken == "" {
		http.Error(w, "bepusdt token not configured", 500)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad body", 400)
		return
	}
	// 业务用例收口：验签/幂等/发卡/取消均在 order application 内完成，
	// handler 不接触支付 SDK 与数据库。
	if err := s.orders.HandlePaymentCallback("bepusdt", logging.RequestID(r.Context()), body); err != nil {
		http.Error(w, "callback rejected", 400)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

func (s *Server) handleHashPayNotify(w http.ResponseWriter, r *http.Request) {
	payCfg := s.settings.PaymentConfig()
	if payCfg.HashPayMerchantID == "" || payCfg.HashPayPrivateKey == "" {
		http.Error(w, "hashpay not configured", 500)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad body", 400)
		return
	}
	if err := s.orders.HandlePaymentCallback("hashpay", logging.RequestID(r.Context()), body); err != nil {
		http.Error(w, "callback rejected", 400)
		return
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// handleDynamicPath 兜底路由：仅处理与当前配置一致的支付回调路径，其余 404。
func (s *Server) handleDynamicPath(w http.ResponseWriter, r *http.Request) {
	if r.Method == http.MethodPost && r.URL.Path == s.settings.NotifyPath() {
		s.handlePaymentNotify(w, r)
		return
	}
	if r.Method == http.MethodPost && r.URL.Path == s.settings.HashPayNotifyPath() {
		s.handleHashPayNotify(w, r)
		return
	}
	http.NotFound(w, r)
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
	return s.requireRole(admindomain.RoleViewer, next)
}

// requireRole 要求至少指定角色权限。
func (s *Server) requireRole(min string, next http.Handler) http.Handler {
	// 管理接口限流（稍宽）：默认 300 次/分钟/IP，避免导出/统计影响公共接口的严格限流。
	limited := s.rateLimitMiddleware("admin_api", 300, func(w http.ResponseWriter, r *http.Request) {
		next.ServeHTTP(w, r)
	})
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !s.roleAtLeast(r, min) {
			writeJSON(w, http.StatusUnauthorized, map[string]any{"error": "unauthorized"})
			return
		}
		// CSRF 纵深防御：非幂等请求校验 Origin 与 Host 同源（浏览器跨站请求被拦截；
		// 无 Origin 的 API 客户端如 curl 不受影响）。
		if r.Method != http.MethodGet && r.Method != http.MethodHead && !sameOrigin(r) {
			writeJSON(w, http.StatusForbidden, map[string]any{"error": "cross-origin request rejected"})
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		limited(w, r)
	})
}

// sameOrigin 校验请求 Origin 与 Host 同源（无 Origin 视为非浏览器客户端，放行）。
func sameOrigin(r *http.Request) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" || (u.Scheme != "http" && u.Scheme != "https") {
		return false
	}
	host := r.Host
	requestHost, requestPort, requestHasPort := host, "", false
	if h, p, err := net.SplitHostPort(host); err == nil {
		requestHost, requestPort, requestHasPort = h, p, true
	}
	if !requestHasPort {
		requestHost = host
	}
	if originPort := u.Port(); originPort != "" {
		if !requestHasPort || originPort != requestPort {
			return false
		}
	}
	return strings.EqualFold(u.Hostname(), requestHost)
}

// audit 记录一条管理员审计日志（记录谁/何时/改了什么/前后值）。
func (s *Server) recordAudit(r *http.Request, action, targetType, targetID, before, after string) {
	_ = s.audit.Audit(s.currentAdminID(r), s.currentAdminName(r), action, targetType, targetID, before, after)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, adminID int64) error {
	// 生产部署由 Caddy/Cloudflare 终止 TLS，Go 侧 r.TLS 恒为 nil，
	// 需根据 X-Forwarded-Proto 判断客户端是否为 HTTPS，否则 Cookie 不带 Secure。
	secure := requestIsHTTPS(r)
	id := idgen.RandomToken(24)
	expiry := time.Now().Add(12 * time.Hour)
	// 会话持久化到数据库，服务重启不丢登录态。
	if err := s.admin.CreateSession(id, adminID, expiry.Unix()); err != nil {
		return fmt.Errorf("create session: %w", err)
	}
	// HTTPS 下使用 __Host- 前缀（强制 Secure + Path=/ + 无 Domain）；
	// 纯 HTTP 部署（SKIP_SSL / 本地开发）下 __Host- 前缀会被浏览器拒绝，
	// 此时回退为普通 Cookie 名，保证登录可用。
	name := "shop_session"
	if secure {
		name = "__Host-shop_session"
	}
	http.SetCookie(w, &http.Cookie{Name: name, Value: id + "." + s.signSession(id), Path: "/", HttpOnly: true, Secure: secure, SameSite: http.SameSiteLaxMode, Expires: expiry})
	return nil
}

func (s *Server) sessionID(r *http.Request) (string, bool) {
	c, err := r.Cookie("__Host-shop_session")
	if err != nil {
		c, err = r.Cookie("shop_session")
	}
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
	h := hmac.New(sha256.New, []byte(s.sessionKey))
	h.Write([]byte(id))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// maintToken 生成维护模式解锁 Cookie：HMAC(session_secret, "maint:"+hash)，
// 服务端密钥参与，避免离线爆破裸 SHA-256。
func (s *Server) maintToken(hash string) string {
	mac := hmac.New(sha256.New, []byte(s.sessionKey))
	_, _ = mac.Write([]byte("maint:" + hash))
	return hex.EncodeToString(mac.Sum(nil))
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
	var adminID int64
	var expiresAt int64
	adminID, expiresAt, err := s.admin.SessionAdminID(id)
	if err != nil {
		if err != sql.ErrNoRows {
			log.Printf("session lookup: %v", err)
		}
		return 0, "", false
	}
	if time.Now().Unix() >= expiresAt {
		_ = s.admin.DeleteSession(id)
		return 0, "", false
	}
	// 滑动续期：仅在剩余不足 1 小时时刷新，减少每次请求的写放大。
	if expiresAt-time.Now().Unix() < 3600 {
		_ = s.admin.SlideSession(id, time.Now().Add(12*time.Hour).Unix())
	}
	var role string
	role, err = s.admin.AdminRole(adminID)
	if err != nil {
		// 管理员已被删除：吊销其会话，避免降级为 viewer 继续访问。
		_ = s.admin.DeleteSession(id)
		return 0, "", false
	}
	return adminID, role, true
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
	name, _ := s.admin.AdminUsername(id)
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
	case admindomain.RoleAdmin:
		return 3
	case admindomain.RoleOperator:
		return 2
	case admindomain.RoleViewer:
		return 1
	}
	return 0
}
