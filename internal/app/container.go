package app

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	inventorydomain "shop/internal/modules/inventory/domain"
	orderdomain "shop/internal/modules/order/domain"
	"time"

	notify "shop/internal/integrations/notification"
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
	productapp "shop/internal/modules/product/application"
	productdomain "shop/internal/modules/product/domain"
	productsqlite "shop/internal/modules/product/repository/sqlite"
	settingsapp "shop/internal/modules/settings/application"
	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	"shop/internal/platform/backup"
	"shop/internal/platform/config"
	platformevents "shop/internal/platform/events"
	"shop/internal/platform/logging"
	mailqueue "shop/internal/platform/mailqueue"
	"shop/internal/platform/outbox"
	events "shop/internal/platform/outbox"
	"shop/internal/platform/scheduler"
	"shop/internal/platform/scheduler/jobs"
	"shop/internal/platform/security"
	"shop/internal/shared/clock"
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

func NewHandler(ctx context.Context, cfg config.Config, database *sql.DB) (http.Handler, error) {
	bus := jobs.NewBus(1024)
	sessionSecret, err := settingssqlite.EnsureSessionSecretWithError(database)
	if err != nil {
		return nil, fmt.Errorf("ensure session secret: %w", err)
	}
	cipher := security.NewCipher(sessionSecret)
	settingsStore := settingssqlite.NewStore(database)
	notifier := notify.New(cfg, database, bus,
		notifySettingsReader{store: settingsStore, cipher: cipher},
		notifyOrderLogWriter{db: database})
	s := &Server{
		db:         database,
		cfg:        cfg,
		bus:        bus,
		notifier:   notifier,
		dbPath:     cfg.DatabasePath,
		startTime:  time.Now(),
		sessionKey: sessionSecret,
		limiters:   make(map[string]*RateLimiter),
		linkSent:   make(map[string]int64),
	}
	adminStore := adminsqlite.NewStore(database)
	auditStore := auditsqlite.NewAuditRepository(database)
	s.settings = settingsapp.NewSettingsService(settingsStore, cipher, cfg)
	s.admin = adminapp.NewAdminService(adminStore, cipher, notifier.NotifySystemError)
	s.audit = auditapp.NewAuditService(auditStore)
	s.notifySvc = settingsapp.NewNotifyService(notifier)
	s.jobsSvc = adminapp.NewJobsService(adminStore)
	// 异步任务 worker：邮件 / Telegram / Webhook（HTTP 层只发布事件）。
	bus.Start(ctx, 2, notifier.Handler())

	orderRepo := ordersqlite.NewOrderRepositoryWithTZ(database, clock.LocationFromTimezone(s.settings.SiteSettings().Timezone))
	// 跨模块事务端口：卡密 SQL 归 inventory，优惠券回滚归 coupon，组合根只做装配。
	orderRepo.SetCardTxOps(inventorysqlite.NewTxOps())
	orderRepo.SetCouponTxOps(couponsqlite.NewTxOps())
	orderRepo.SetOutboxEncoder(func(o orderdomain.Order, cards []inventorydomain.Card) ([]ordersqlite.OutboxEvent, error) {
		paid, err := orderapp.EncodeEvent(orderapp.OrderPaidEvent{Order: o, Cards: cards})
		if err != nil {
			return nil, err
		}
		evs := []ordersqlite.OutboxEvent{{Type: "order.paid", Payload: paid}}
		if o.DeliveryType != productdomain.DeliveryTypeManual || o.Status == orderdomain.OrderDelivered {
			delivered, err := orderapp.EncodeEvent(orderapp.OrderDeliveredEvent{Order: o, Cards: cards})
			if err != nil {
				return nil, err
			}
			evs = append(evs, ordersqlite.OutboxEvent{Type: "order.delivered", Payload: delivered})
		}
		return evs, nil
	})
	keyRepo := inventorysqlite.NewKeyRepository(database)
	inventoryRepo := inventorysqlite.NewInventoryRepository(database)
	couponRepo := couponsqlite.NewCouponRepository(database)
	s.orders = orderapp.NewOrderService(orderRepo, s.paymentGateway, s.settings.PaymentServiceConfig)
	s.orders.SendPaid = notifier.SendPaid
	s.orders.SystemError = notifier.NotifySystemError
	// 领域事件 → 消费者扇出（每个消费者独立 goroutine + panic 隔离；
	// service 只发布类型化事件，不接触 bus；直接事件 + outbox 共用同一分发器）。
	dispatch := platformevents.NewFanout(
		platformevents.Consumer{Name: "notify", Handle: notifyEventConsumer(notifier)},
		platformevents.Consumer{Name: "mail", Handle: mailEventConsumer(notifier)},
	)
	outboxDispatch := platformevents.NewFanout(
		platformevents.Consumer{Name: "notify", Handle: notifyOutboxConsumer(notifier)},
		platformevents.Consumer{Name: "mail", Handle: mailOutboxConsumer(notifier)},
	)
	dispatch.SetPanicHandler(func(name string, r any) {
		logging.App().Sugar().Errorf("event consumer %s panic: %v", name, r)
	})
	outboxDispatch.SetPanicHandler(func(name string, r any) {
		logging.App().Sugar().Errorf("outbox event consumer %s panic: %v", name, r)
	})
	s.orders.SetEvents(dispatch)
	s.orders.SendLinks = notifier.SendOrderLinks
	s.orders.LowStockThreshold = s.settings.LowStockThreshold
	s.orders.SetInventory(inventoryRepo)
	s.orders.SetCouponStore(couponRepo)
	s.products = productapp.NewProductService(productsqlite.NewProductRepository(database))
	s.products.SetInventory(inventoryRepo)
	s.orders.SetProductReader(s.products)
	s.orders.SetGatewayProvider(s.paymentGateway)
	s.inventory = inventoryapp.NewInventoryService(keyRepo)
	s.coupons = couponapp.NewCouponService(couponRepo)
	s.stats = adminapp.NewStatsService(orderRepo, keyRepo, s.products, adminStore)

	mux := http.NewServeMux()
	mux.HandleFunc("GET /health", s.handleHealth)
	mux.HandleFunc("POST "+s.settings.NotifyPath(), s.handlePaymentNotify)
	mux.HandleFunc("POST "+s.settings.HashPayNotifyPath(), s.handleHashPayNotify)
	// 兜底：回调路径可在后台运行时修改，这里按"当前配置路径"动态匹配，
	// 避免改路径后新交易回调 404（无需重启即生效）。
	mux.HandleFunc("/{path...}", s.handleDynamicPath)
	s.registerAPI(mux)
	s.registerModuleRoutes(mux)
	s.registerDocs(mux)
	mux.Handle("GET /admin/assets/", http.StripPrefix("/admin", http.FileServer(adminAssetsFS())))
	mux.HandleFunc("GET /admin", s.adminIndex)
	mux.HandleFunc("GET /admin/{path...}", s.adminIndex)
	s.mux = mux
	// 后台任务系统（cron + worker）：订单过期 / 邮件重试 / 清理 / 备份。
	scheduler := scheduler.NewScheduler()
	// 任务执行记录（job_runs 表）：后台可查看每个任务最后执行结果。
	scheduler.SetRecorder(func(name string, startedAt, finishedAt int64, err error) {
		// outbox_publish 每秒执行，不写 job_runs（失败由 app.log + 死信机制覆盖），避免表膨胀。
		if name == "outbox_publish" {
			return
		}
		_ = adminsqlite.RecordJobRun(s.db, name, startedAt, finishedAt, err)
	})
	// order_expire / email_retry / cleanup 启动后立即执行一次（进程崩溃后的补偿清理）。
	mailRetrySvc := mailqueue.NewRetryService(database, notifier.SendRawMail)
	outboxSvc := outbox.NewOutboxService(database)
	backupSvc := backup.NewService(s.dbPath, 7)
	scheduler.Add("order_expire", 5*time.Minute, true, (&jobs.OrderExpireJob{Service: s.orders, TimeoutSec: func() int { return s.settings.PaymentServiceConfig().TimeoutSec }}).Run)
	scheduler.Add("email_retry", time.Minute, true, (&jobs.EmailRetryJob{Service: mailRetrySvc}).Run)
	// Outbox 消费者：近实时发布支付成功/发货事件（崩溃恢复后立即补发）。
	scheduler.Add("outbox_publish", time.Second, true, (&jobs.OutboxPublishJob{Service: outboxSvc, Deliver: func(payload string) error {
		e, err := orderapp.DecodeEvent(payload)
		if err != nil {
			return err
		}
		return outboxDispatch.PublishSync(e)
	}}).Run)
	scheduler.Add("cleanup", 5*time.Minute, true, (&jobs.CleanupJob{RunFunc: func(ctx context.Context) error {
		cleanups := []func() error{
			func() error {
				return s.admin.CleanupExpiredSessions(time.Now().Unix())
			},
			func() error {
				return s.audit.CleanupOld(time.Now().Add(-180 * 24 * time.Hour).Unix())
			},
			func() error {
				return s.orders.CleanupOldLogs(time.Now().Add(-180 * 24 * time.Hour).Unix())
			},
			func() error {
				return s.admin.CleanupOldJobRuns(time.Now().Add(-7 * 24 * time.Hour).Unix())
			},
			func() error {
				return events.DeleteOldOutboxEvents(s.db, time.Now().Add(-30*24*time.Hour).Unix())
			},
			func() error {
				return mailqueue.DeleteStaleMailQueue(s.db, time.Now().Add(-30*24*time.Hour).Unix())
			},
			func() error {
				return events.DeleteOldProcessedEvents(s.db, time.Now().Add(-90*24*time.Hour).Unix())
			},
			func() error {
				return events.DeleteOldDeadEvents(s.db, time.Now().Add(-90*24*time.Hour).Unix())
			},
			func() error {
				s.cleanupMemory()
				return nil
			},
		}
		for _, fn := range cleanups {
			if err := fn(); err != nil {
				return err
			}
		}
		return nil
	}}).Run)
	scheduler.Add("backup", 24*time.Hour, false, (&jobs.BackupJob{Service: backupSvc}).Run)
	scheduler.Start(ctx)
	s.logStartupInfo()
	return s, nil
}
