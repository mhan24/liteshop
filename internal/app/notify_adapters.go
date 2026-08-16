package app

import (
	"database/sql"

	notify "shop/internal/integrations/notification"
	orderdomain "shop/internal/modules/order/domain"
	ordersqlite "shop/internal/modules/order/repository/sqlite"
	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	"shop/internal/platform/security"
)

// notifySettingsReader 实现 notify.SettingsReader：settings/secrets 访问归 settings 模块，
// 组合根只做装配，通知集成不直连数据库。
type notifySettingsReader struct {
	store  *settingssqlite.Store
	cipher *security.Cipher
}

func (r notifySettingsReader) GetSetting(key string) (string, error) {
	return r.store.GetSetting(key)
}

func (r notifySettingsReader) GetSecret(key string) (string, error) {
	return r.store.GetSecret(key, r.cipher)
}

// notifyOrderLogWriter 实现 notify.OrderLogWriter：order_logs 写入归 order 模块。
type notifyOrderLogWriter struct {
	db *sql.DB
}

func (w notifyOrderLogWriter) AddOrderLog(orderID int64, event, message string, fromStatus, toStatus orderdomain.Status, adminID int64, metadata string) error {
	return ordersqlite.AddOrderLog(w.db, orderID, event, message, fromStatus, toStatus, adminID, metadata)
}

var (
	_ notify.SettingsReader = notifySettingsReader{}
	_ notify.OrderLogWriter = notifyOrderLogWriter{}
)
