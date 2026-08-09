package service

import (
	"shop/internal/models"
	"shop/internal/security"
)

// 本文件定义 service 依赖的数据访问接口（消费者侧接口）。
// 具体实现位于 internal/db/repository（SQLite）；测试可用任意 mock 实现。

// OrderRepository 订单/优惠券数据访问接口。
type OrderRepository interface {
	GetOrderByNo(orderNo string) (models.Order, error)
	GetOrderByID(id int64) (models.Order, error)
	OrdersByContact(contact string, limit int) ([]models.Order, error)
	ListOrders(where string, args []any, limit int) ([]models.Order, error)
	GetOrderCards(orderID int64) ([]models.Card, error)
	CreatePendingOrder(order *models.Order) error
	SetTradeInfo(orderID int64, tradeID, paymentURL string) error
	MarkPaidAndDeliver(orderID int64, tradeID, blockTx string, paidAt int64) (int64, error)
	CompleteFreeOrder(orderID int64, paidAt int64) (int64, error)
	DeliverCards(orderID int64) error
	ReleaseLockedCards(orderID int64) error
	CancelOrder(orderID int64) (string, bool, error)
	ExpireOrder(orderID int64) (string, bool, error)
	ReserveCardsFromStock(productID int64, qty int, orderID int64) (int, error)
	SetOrderStatus(orderID int64, status string) error
	MarkPaymentFailed(orderID int64) error
	SetPaymentStatus(orderID int64, status string) error
	GetPaymentStatus(orderID int64) (string, error)
	GetOrderStatus(orderID int64) (string, error)
	OrderCounts() (todayOrders, todaySales, pending, paymentFailed, deliveryFailed int, todayRevenue int64, err error)
	RecentOrders(limit int) ([]models.Order, error)
	AddLog(orderID int64, event, message, from, to string, adminID int64) error
	Logs(orderID int64) ([]models.OrderEvent, error)
	DailyRevenue(days int) ([]models.DailyRevenueRow, error)
	ProductSales(limit int) ([]models.ProductSaleRow, error)
	CostSince(ts int64) (int64, error)
	CostSourceStats() (orderTime, migrationEstimate, unknown int, err error)
	ApplyCoupon(code string, amountCents int64, productID int64) (int64, error)
	UseCoupon(couponID int64, orderNo string, discountCents int64) error
	RefundByOrderNo(orderNo string) (bool, error)
	GetCouponIDByCode(code string) (int64, error)
	ListCoupons() ([]models.Coupon, error)
	CreateCoupon(c models.Coupon) error
	UpdateCoupon(c models.Coupon) error
	DeleteCoupon(id int64) error
}

// ProductRepository 商品数据访问接口。
type ProductRepository interface {
	ListViews(activeOnly bool) ([]models.ProductView, error)
	GetByID(id int64) (models.ProductView, error)
	GetBySlug(slug string) (models.ProductView, error)
	GetActiveByID(id int64) (models.ProductView, error)
	Create(p models.Product) error
	Update(p models.Product, id int64) error
	GetName(id int64) string
	AllCategories() ([]string, error)
	LowStock(threshold int) ([]models.ProductView, error)
}

// KeyRepository 卡密数据访问接口。
type KeyRepository interface {
	ListByProduct(productID int64) ([]models.Card, error)
	Add(productID int64, contents []string, dedupe bool) (added, skipped int, err error)
	DeleteAvailable(cardID int64) error
	AvailableCount(productID int64) (int, error)
	SoldCountSince(ts int64) (int, error)
	StockStats() (products, available, sold, locked int, err error)
}

// SettingsStore 系统配置/密钥数据访问接口。
type SettingsStore interface {
	GetSetting(key string) (string, error)
	SetSetting(key, value string) error
	AllSettings() (map[string]string, error)
	GetSecret(key string, cipher *security.Cipher) (string, error)
	SetSecret(key, value string, cipher *security.Cipher) error
	SecretKeys() []string
	ResetAllTables() error
	SettingsVersion() int
}

// AdminStore 管理员/会话/审计数据访问接口。
type AdminStore interface {
	HasAdmin() bool
	SeedAdmin(username, password string) (bool, error)
	AdminByUsername(username string) (adminID int64, hash, totpSecret string, totpEnabled bool, err error)
	AdminRole(id int64) (string, error)
	AdminUsername(id int64) (string, error)
	AdminPasswordHash(id int64) (string, error)
	UpdateAdminAccount(id int64, username, hash string) error
	AdminTOTP(id int64) (enabled bool, secret string, err error)
	SetAdminTOTPSecret(id int64, secret string) error
	SetAdminTOTPEnabled(id int64, enabled bool) error
	ListAdmins() ([]models.AdminRow, error)
	AdminCountByRole(role string) (int, error)
	CreateAdmin(username, passwordHash, role string) error
	SetAdminRoleGuarded(id int64, role string) error
	DeleteAdmin(id int64) error
	CreateSession(id string, adminID int64, expiresAt int64) error
	SessionAdminID(id string) (adminID, expiresAt int64, err error)
	SlideSessionExpiry(id string, expiresAt int64) error
	DeleteSession(id string) error
	DeleteSessionsByAdmin(adminID int64) error
	DeleteAllSessions() error
	EnsureSessionSecret() string
	AddAuditLog(adminID int64, username, action, targetType, targetID, before, after string) error
	AuditLogs(limit int) ([]models.AuditLog, error)
}

// JobsStore 后台任务执行记录数据访问接口。
type JobsStore interface {
	LatestJobRuns() ([]models.JobRun, error)
	PendingMailCount() (int, error)
}

// StatsStore 健康/统计所需的数据访问接口。
type StatsStore interface {
	SchemaVersion() int
	IntegrityOK() bool
	PendingMailCount() (int, error)
	LatestJobRuns() ([]models.JobRun, error)
}
