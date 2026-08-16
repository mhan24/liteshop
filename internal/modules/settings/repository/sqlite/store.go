package sqlite

import (
	"database/sql"

	"shop/internal/platform/security"
)

// Store 实现 settings/application.SettingsStore。
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

func (s *Store) GetSetting(key string) (string, error) {
	return GetSetting(s.db, key)
}

func (s *Store) SetSetting(key, value string) error {
	return SetSetting(s.db, key, value)
}

func (s *Store) AllSettings() (map[string]string, error) {
	return AllSettings(s.db)
}

func (s *Store) GetSecret(key string, c *security.Cipher) (string, error) {
	return GetSecret(s.db, key, c)
}

func (s *Store) SetSecret(key, value string, c *security.Cipher) error {
	return SetSecret(s.db, key, value, c)
}

func (s *Store) SecretKeys() []string {
	return SecretSettingKeys
}

func (s *Store) SettingsVersion() int {
	return SettingsVersion(s.db)
}

func (s *Store) ResetAllTables() error {
	return ResetAllTables(s.db)
}
