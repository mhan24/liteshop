package application

import (
	"shop/internal/platform/config"
	"shop/internal/platform/security"
)

// NotifierPort 通知集成端口（由 notification 适配器实现，应用不接触 SMTP/Telegram 实现）。
type NotifierPort interface {
	SendTestEvent(event, channel string) error
	SendTestEmail(to string) error
	SendTestTelegram() error
	CurrentConfig() config.Config
	EventTemplates() map[string]map[string]string
	NotifySystemError(message string)
}

// SettingsStore 配置/密钥数据访问端口。
type SettingsStore interface {
	GetSetting(key string) (string, error)
	SetSetting(key, value string) error
	AllSettings() (map[string]string, error)
	GetSecret(key string, cipher *security.Cipher) (string, error)
	SetSecret(key, value string, cipher *security.Cipher) error
	SecretKeys() []string
	SettingsVersion() int
	ResetAllTables() error
}
