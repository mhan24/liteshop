package notify

import orderdomain "shop/internal/modules/order/domain"

// SettingsReader 站点/通知配置读取端口：实现归 settings 模块，由组合根注入。
// 通知集成不得直接读取 settings / secrets 表。
type SettingsReader interface {
	GetSetting(key string) (string, error)
	GetSecret(key string) (string, error)
}

// OrderLogWriter 订单日志写入端口：实现归 order 模块，由组合根注入。
// 通知集成只记录发送结果，不直接写 order_logs 表。
type OrderLogWriter interface {
	AddOrderLog(orderID int64, event, message string, fromStatus, toStatus orderdomain.Status, adminID int64, metadata string) error
}
