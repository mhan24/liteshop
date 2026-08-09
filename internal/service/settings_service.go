package service

import (
	"database/sql"
	"strings"

	"shop/internal/config"
	"shop/internal/db/repository"
	"shop/internal/security"
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
	db     *sql.DB
	cipher *security.Cipher
	cfg    config.Config
}

func NewSettingsService(db *sql.DB, cipher *security.Cipher, cfg config.Config) *SettingsService {
	return &SettingsService{db: db, cipher: cipher, cfg: cfg}
}

// Get 读取配置（忽略错误，返回去空格值）。
func (s *SettingsService) Get(key string) string {
	v, err := repository.GetSetting(s.db, key)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// Set 写入配置。
func (s *SettingsService) Set(key, value string) error {
	return repository.SetSetting(s.db, key, value)
}

// SetMany 批量写入配置。
func (s *SettingsService) SetMany(values map[string]string) error {
	for k, v := range values {
		if err := repository.SetSetting(s.db, k, v); err != nil {
			return err
		}
	}
	return nil
}

// All 返回全部配置。
func (s *SettingsService) All() (map[string]string, error) {
	return repository.AllSettings(s.db)
}

// IsSecretKey 是否为敏感配置键（secrets 表键 + 会话主密钥）。
func (s *SettingsService) IsSecretKey(k string) bool {
	if k == "session_secret" {
		return true
	}
	for _, sk := range repository.SecretSettingKeys {
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
	v, err := repository.GetSecret(s.db, key, s.cipher)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(v)
}

// SetSecret 加密并写入敏感配置。
func (s *SettingsService) SetSecret(key, value string) error {
	return repository.SetSecret(s.db, key, value, s.cipher)
}
