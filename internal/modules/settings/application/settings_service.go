package application

import (
	"strings"

	"shop/internal/platform/config"
	"shop/internal/platform/security"
)

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

// SettingsService 系统配置/密钥的统一入口（按职责拆分到 settings_*.go 小文件）。
type SettingsService struct {
	store  SettingsStore
	cipher *security.Cipher
	cfg    config.Config
}

func NewSettingsService(store SettingsStore, cipher *security.Cipher, cfg config.Config) *SettingsService {
	return &SettingsService{store: store, cipher: cipher, cfg: cfg}
}

// Get 读取配置（忽略错误，返回去空格值）。
func (s *SettingsService) Get(key string) string {
	v, err := s.store.GetSetting(key)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// Set 写入配置。
func (s *SettingsService) Set(key, value string) error {
	return s.store.SetSetting(key, value)
}

// SetMany 批量写入配置。
func (s *SettingsService) SetMany(values map[string]string) error {
	for k, v := range values {
		if err := s.store.SetSetting(k, v); err != nil {
			return err
		}
	}
	return nil
}

// All 返回全部配置。
func (s *SettingsService) All() (map[string]string, error) {
	return s.store.AllSettings()
}

// IsSecretKey 是否为敏感配置键（secrets 表键 + 会话主密钥）。
func (s *SettingsService) IsSecretKey(k string) bool {
	if k == "session_secret" {
		return true
	}
	for _, sk := range s.store.SecretKeys() {
		if k == sk {
			return true
		}
	}
	return false
}

// GetSecret 读取并解密敏感配置。
func (s *SettingsService) GetSecret(key string) string {
	if s.cipher == nil {
		return ""
	}
	v, err := s.store.GetSecret(key, s.cipher)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// SetSecret 加密并写入敏感配置。
func (s *SettingsService) SetSecret(key, value string) error {
	return s.store.SetSecret(key, value, s.cipher)
}

// ConfigVersion 返回当前配置版本（settings 结构升级版本号）。
func (s *SettingsService) ConfigVersion() int {
	return s.store.SettingsVersion()
}
