package api

import (
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"go.uber.org/zap"
	"shop/internal/config"
	"shop/internal/db/repository"
	"shop/internal/events"
	"shop/internal/jobs"
	"shop/internal/logging"
	"shop/internal/models"
	"shop/internal/notify"
	"shop/internal/payment"
	"shop/internal/security"
	"shop/internal/service"
	"shop/internal/version"
)

// 编译期断言：SQLite 实现满足 service 接口（便于后续换实现 / mock 测试）。
var (
	_ service.OrderRepository   = (*repository.OrderRepository)(nil)
	_ service.ProductRepository = (*repository.ProductRepository)(nil)
	_ service.KeyRepository     = (*repository.KeyRepository)(nil)
	_ service.SettingsStore     = (*repository.Store)(nil)
	_ service.AdminStore        = (*repository.Store)(nil)
)

type Server struct {
	mux       *http.ServeMux
	db        *sql.DB
	cfg       config.Config
	notifier  *notify.Notifier
	orders    *service.OrderService
	products  *service.ProductService
	settings  *service.SettingsService
	admin     *service.AdminService
	notifySvc *service.NotifyService
	stats     *service.StatsService
	jobsSvc   *service.JobsService
	dbPath    string
	startTime time.Time

	limitersMu sync.Mutex
	limiters   map[string]*RateLimiter

	linkMu   sync.Mutex
	linkSent map[string]int64 // 订单查看链接邮件冷却（按邮箱）
}

func NewHandler(ctx context.Context, cfg config.Config, database *sql.DB) (http.Handler, error) {
	bus := jobs.NewBus(1024)
	cipher := security.NewCipher(repository.EnsureSessionSecret(database))
	notifier := notify.New(cfg, database, bus, cipher)
	s := &Server{
		db:        database,
		cfg:       cfg,
		notifier:  notifier,
		dbPath:    cfg.DatabasePath,
		startTime: time.Now(),
		limiters:  make(map[string]*RateLimiter),
		linkSent:  make(map[string]int64),
	}
	store := repository.NewStore(database)
	s.settings = service.NewSettingsService(store, cipher, cfg)
	s.admin = service.NewAdminService(store, cipher, notifier.NotifySystemError)
	s.notifySvc = service.NewNotifyService(notifier)
	s.jobsSvc = service.NewJobsService(store)
	// 异步任务 worker：邮件 / Telegram / Webhook（HTTP 层只发布事件）。
	bus.Start(ctx, 2, notifier.Handler())

	orderRepo := repository.NewOrderRepositoryWithTZ(database, models.LocationFromTimezone(s.settings.SiteSettings().Timezone))
	keyRepo := repository.NewKeyRepository(database)
	s.orders = service.NewOrderService(orderRepo, s.paymentGateway, s.settings.PaymentServiceConfig)
	s.orders.SendPaid = notifier.SendPaid
	s.orders.SystemError = notifier.NotifySystemError
	// 领域事件 → 消费者扇出（每个消费者独立 goroutine + panic 隔离；
	// service 只发布类型化事件，不接触 bus；直接事件 + outbox 共用同一分发器）。
	dispatch := events.NewFanout(
		events.Consumer{Name: "notify", Handle: notifyEventConsumer(notifier)},
		events.Consumer{Name: "mail", Handle: mailEventConsumer(notifier)},
	)
	dispatch.SetPanicHandler(func(name string, r any) {
		logging.App().Sugar().Errorf("event consumer %s panic: %v", name, r)
	})
	s.orders.SetEvents(dispatch)
	s.orders.SendLinks = notifier.SendOrderLinks
	s.orders.LowStockThreshold = s.settings.LowStockThreshold
	s.orders.SetKeyRepository(keyRepo)
	s.products = service.NewProductService(repository.NewProductRepository(database), keyRepo)
	s.stats = service.NewStatsService(orderRepo, keyRepo, repository.NewProductRepository(database), store)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST "+s.settings.NotifyPath(), s.handlePaymentNotify)
	mux.HandleFunc("POST "+s.settings.HashPayNotifyPath(), s.handleHashPayNotify)
	// 兜底：回调路径可在后台运行时修改，这里按"当前配置路径"动态匹配，
	// 避免改路径后新交易回调 404（无需重启即生效）。
	mux.HandleFunc("/{path...}", s.handleDynamicPath)
	s.registerAPI(mux)
	s.registerDocs(mux)
	mux.Handle("GET /admin/assets/", http.StripPrefix("/admin", http.FileServer(adminAssetsFS())))
	mux.HandleFunc("GET /admin", s.adminIndex)
	mux.HandleFunc("GET /admin/{path...}", s.adminIndex)
	s.mux = mux
	// 后台任务系统（cron + worker）：订单过期 / 邮件重试 / 清理 / 备份。
	scheduler := jobs.NewScheduler()
	// 任务执行记录（job_runs 表）：后台可查看每个任务最后执行结果。
	scheduler.SetRecorder(func(name string, startedAt, finishedAt int64, err error) {
		// outbox_publish 每秒执行，不写 job_runs（失败由 app.log + 死信机制覆盖），避免表膨胀。
		if name == "outbox_publish" {
			return
		}
		_ = repository.RecordJobRun(s.db, name, startedAt, finishedAt, err)
	})
	// order_expire / email_retry / cleanup 启动后立即执行一次（进程崩溃后的补偿清理）。
	scheduler.Add("order_expire", 5*time.Minute, true, jobs.OrderExpireJob(s.orders, func() int { return s.settings.PaymentServiceConfig().TimeoutSec }))
	scheduler.Add("email_retry", time.Minute, true, jobs.EmailRetryJob(s.db, notifier.SendRawMail))
	// Outbox 消费者：近实时发布支付成功/发货事件（崩溃恢复后立即补发）。
	scheduler.Add("outbox_publish", time.Second, true, jobs.OutboxPublishJob(s.db, dispatch))
	scheduler.Add("cleanup", 5*time.Minute, true, jobs.CleanupJob(s.db, s.cleanupMemory))
	scheduler.Add("backup", 24*time.Hour, false, jobs.BackupJob(s.dbPath, 7))
	scheduler.Start(ctx)
	s.logStartupInfo()
	return s, nil
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
func notifyEventConsumer(notifier *notify.Notifier) func(events.Event) {
	return func(e events.Event) {
		switch ev := e.(type) {
		case events.OrderCreatedEvent:
			payload := notifier.OrderPayload(notify.EventOrderCreated, ev.Order, nil, nil)
			notifier.Notify(notify.EventOrderCreated, payload)
		case events.OrderPaidEvent:
			payload := notifier.OrderPayload(notify.EventPaymentSuccess, ev.Order, nil, nil)
			delete(payload, "contact") // 买家邮件由 SendPaid 发送，避免重复
			notifier.Notify(notify.EventPaymentSuccess, payload)
		case events.OrderDeliveredEvent:
			payload := notifier.OrderPayload(notify.EventDelivered, ev.Order, ev.Cards, nil)
			delete(payload, "contact")
			notifier.Notify(notify.EventDelivered, payload)
		case events.LowStockEvent:
			notifier.NotifyLowStock(ev.ProductID, ev.ProductName, ev.Available, ev.Threshold)
		}
	}
}

// mailEventConsumer 买家发卡邮件消费者（OrderPaid → SendPaid，独立失败不影响其他消费者）。
func mailEventConsumer(notifier *notify.Notifier) func(events.Event) {
	return func(e events.Event) {
		if ev, ok := e.(events.OrderPaidEvent); ok {
			// 人工手动交付订单：支付成功不随支付发卡邮件，发货内容由管理员发货时发送。
			if ev.Order.DeliveryType == models.DeliveryTypeManual {
				return
			}
			notifier.SendPaid(ev.Order, ev.Cards)
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
			"mail_queue_size": health.MailQueuePending,
			"last_success":    health.LastJobSuccess,
		},
		"payment": paymentStatus,
	}
	status := http.StatusOK
	if dbStatus != "ok" {
		status = http.StatusServiceUnavailable
	}
	writeJSON(w, status, body)
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
	if r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https") {
		w.Header().Set("Strict-Transport-Security", "max-age=31536000; includeSubDomains")
	}
	// 关联 ID：一次请求一个 request_id，贯穿 app/payment/security 日志与响应头。
	requestID := models.RandomToken(16)
	w.Header().Set("X-Request-ID", requestID)
	ctx := logging.WithRequestID(r.Context(), requestID)
	rec := &statusRecorder{ResponseWriter: w, status: http.StatusOK}
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
		"status", rec.status,
		"duration_ms", time.Since(start).Milliseconds(),
	)
}

// statusRecorder 记录响应状态码（供请求日志使用）。
type statusRecorder struct {
	http.ResponseWriter
	status int
}

func (r *statusRecorder) WriteHeader(code int) {
	r.status = code
	r.ResponseWriter.WriteHeader(code)
}

func pathID(r *http.Request, name string) (int64, error) {
	return strconv.ParseInt(r.PathValue(name), 10, 64)
}

// paymentGateway 按名称构造支付网关（每次调用读取最新配置）。
func (s *Server) paymentGateway(gateway string) payment.Gateway {
	cfg := s.settings.PaymentConfig()
	if gateway == "hashpay" {
		return payment.NewHashPay(cfg.HashPayBaseURL, cfg.HashPayMerchantID, cfg.HashPayPrivateKey, cfg.HashPayCurrency)
	}
	return payment.NewBEPusdt(cfg.BepusdtBaseURL, cfg.BepusdtToken)
}

var turnstileHTTP = &http.Client{Timeout: 10 * time.Second}

func (s *Server) verifyTurnstileToken(token, remoteIP, host string) error {
	secret := s.settings.TurnstileSecret()
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
		Hostname   string   `json:"hostname"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&result); err != nil {
		return err
	}
	if !result.Success {
		return fmt.Errorf("siteverify rejected token: %s", strings.Join(result.ErrorCodes, ","))
	}
	// hostname 校验：令牌必须签发自当前请求的主机，防止跨站复用；
	// 以 IP 直连/本地开发时不强制（避免非域名部署被误拒）。
	if result.Hostname != "" && host != "" {
		reqHost := host
		if h, _, err := net.SplitHostPort(host); err == nil {
			reqHost = h
		}
		if net.ParseIP(reqHost) == nil && !strings.EqualFold(result.Hostname, reqHost) {
			return fmt.Errorf("turnstile hostname mismatch: %s != %s", result.Hostname, reqHost)
		}
	}
	return nil
}

func clientIP(r *http.Request) string {
	// 仅当对端确为 Cloudflare 边缘时才信任 CF-Connecting-IP：
	// 直连（绕过 CF）的客户端可伪造该头，若无条件信任会绕过所有按 IP 限流。
	if peer := net.ParseIP(remoteIP(r)); peer != nil && isCloudflareIP(peer) {
		if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" && net.ParseIP(ip) != nil {
			return ip
		}
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
	return remoteIP(r)
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

func (s *Server) handlePaymentNotify(w http.ResponseWriter, r *http.Request) {
	payCfg := s.settings.PaymentConfig()
	if payCfg.BepusdtToken == "" {
		http.Error(w, "bepusdt token not configured", 500)
		return
	}
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "bad body", 400)
		return
	}
	// 回调路径决定网关：/notify/bepusdt 一律用 BEpusdt 验签，
	// 与当前启用的下单网关无关，避免切网关后旧交易回调无法处理。
	params, err := payment.NewBEPusdt(payCfg.BepusdtBaseURL, payCfg.BepusdtToken).VerifyCallback(body)
	if err != nil {
		logging.Payment().Warn("bepusdt callback verify failed",
			zap.String("request_id", logging.RequestID(r.Context())),
			zap.Int("body_bytes", len(body)),
			zap.String("result", "verify_failed"),
			zap.Error(err),
		)
		http.Error(w, "invalid signature", 400)
		return
	}
	logging.Payment().Info("bepusdt callback",
		zap.String("request_id", logging.RequestID(r.Context())),
		zap.String("order_no", params["order_id"]),
		zap.String("trade_id", params["trade_id"]),
		zap.String("trace_id", params["trade_id"]),
		zap.String("block_transaction_id", params["block_transaction_id"]),
		zap.String("status", params["status"]),
		zap.Time("callback_time", time.Now()),
	)
	switch params["status"] {
	case "2":
		order, _, changed, err := s.orders.MarkPaidAndDeliver(params["order_id"], "bepusdt", params["trade_id"], params["block_transaction_id"])
		if err != nil {
			logging.Payment().Error("payment callback error",
				zap.String("request_id", logging.RequestID(r.Context())),
				zap.String("order_no", params["order_id"]),
				zap.String("result", "error"),
				zap.Error(err),
			)
			s.notifySvc.SystemError("支付回调处理异常 order=" + params["order_id"] + ": " + err.Error())
		} else {
			logging.Payment().Info("payment delivered",
				zap.String("request_id", logging.RequestID(r.Context())),
				zap.String("order_no", order.OrderNo),
				zap.Int64("amount_cents", order.AmountCents),
				zap.String("trade_id", order.TradeID),
				zap.String("trace_id", order.TradeID),
				zap.String("result", map[bool]string{true: "ok", false: "noop"}[changed]),
			)
		}
		// payment_success / delivered 模板事件由 OrderService 内部回调触发。
	case "3":
		s.orders.HandleGatewayCancel(params["order_id"])
	}
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write([]byte("ok"))
}

// handleHashPayNotify 处理 HashPay 回调（RSA-OAEP-256+A256GCM 加密信封）。
// HashPay 会向商户后台配置的 callback 地址投递订单状态变化：
// paid → 确认支付并发卡；expired/invalid → 关闭订单释放库存。
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
	gw := payment.NewHashPay(payCfg.HashPayBaseURL, payCfg.HashPayMerchantID, payCfg.HashPayPrivateKey, payCfg.HashPayCurrency)
	params, err := gw.VerifyCallback(body)
	if err != nil {
		logging.Payment().Warn("hashpay callback verify failed",
			zap.String("request_id", logging.RequestID(r.Context())),
			zap.Int("body_bytes", len(body)),
			zap.String("result", "verify_failed"),
			zap.Error(err),
		)
		http.Error(w, "invalid signature", 400)
		return
	}
	logging.Payment().Info("hashpay callback",
		zap.String("request_id", logging.RequestID(r.Context())),
		zap.String("order_no", params["order_id"]),
		zap.String("trade_id", params["trade_id"]),
		zap.String("trace_id", params["trade_id"]),
		zap.String("block_transaction_id", params["block_transaction_id"]),
		zap.String("status", params["status"]),
		zap.Time("callback_time", time.Now()),
	)
	switch params["status"] {
	case "paid":
		order, _, changed, err := s.orders.MarkPaidAndDeliver(params["order_id"], "hashpay", params["trade_id"], params["block_transaction_id"])
		if err != nil {
			logging.Payment().Error("payment callback error",
				zap.String("request_id", logging.RequestID(r.Context())),
				zap.String("order_no", params["order_id"]),
				zap.String("result", "error"),
				zap.Error(err),
			)
			s.notifySvc.SystemError("HashPay 支付回调处理异常 order=" + params["order_id"] + ": " + err.Error())
		} else {
			logging.Payment().Info("payment delivered",
				zap.String("request_id", logging.RequestID(r.Context())),
				zap.String("order_no", order.OrderNo),
				zap.Int64("amount_cents", order.AmountCents),
				zap.String("trade_id", order.TradeID),
				zap.String("trace_id", order.TradeID),
				zap.String("result", map[bool]string{true: "ok", false: "noop"}[changed]),
			)
		}
	case "expired", "invalid", "cancelled":
		s.orders.HandleGatewayCancel(params["order_id"])
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
	return s.requireRole(models.RoleViewer, next)
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
	if err != nil || u.Host == "" {
		return false
	}
	host := r.Host
	if h, _, err := net.SplitHostPort(host); err == nil {
		host = h
	}
	return strings.EqualFold(u.Host, host)
}

// audit 记录一条管理员审计日志（记录谁/何时/改了什么/前后值）。
func (s *Server) audit(r *http.Request, action, targetType, targetID, before, after string) {
	_ = s.admin.Audit(s.currentAdminID(r), s.currentAdminName(r), action, targetType, targetID, before, after)
}

func (s *Server) startSession(w http.ResponseWriter, r *http.Request, adminID int64) error {
	// 生产部署由 Caddy/Cloudflare 终止 TLS，Go 侧 r.TLS 恒为 nil，
	// 需根据 X-Forwarded-Proto 判断客户端是否为 HTTPS，否则 Cookie 不带 Secure。
	secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
	id := models.RandomToken(24)
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

func (s *Server) sessionSecret() string {
	return s.admin.SessionSecret()
}

func (s *Server) signSession(id string) string {
	h := hmac.New(sha256.New, []byte(s.sessionSecret()))
	h.Write([]byte(id))
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// maintToken 生成维护模式解锁 Cookie：HMAC(session_secret, "maint:"+hash)，
// 服务端密钥参与，避免离线爆破裸 SHA-256。
func (s *Server) maintToken(hash string) string {
	mac := hmac.New(sha256.New, []byte(s.sessionSecret()))
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
	case models.RoleAdmin:
		return 3
	case models.RoleOperator:
		return 2
	case models.RoleViewer:
		return 1
	}
	return 0
}
