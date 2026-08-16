// Package domain 站点/支付配置领域模型。
package domain

// SiteSettings 站点前台可见配置（含默认值）。
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

// PaymentConfig 提供支付所需配置（由 settings 应用构建，订单应用消费）。
type PaymentConfig struct {
	PublicBaseURL    string
	NotifyURL        string
	BepusdtNotifyURL string
	HashPayNotifyURL string
	TimeoutSec       int
	Fiat             string
	HashPayCurrency  string
	TradeTypes       []string
	EnabledGateways  []string
	Gateway          string
}
