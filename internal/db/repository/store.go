package repository

import (
	"database/sql"

	"shop/internal/models"
	"shop/internal/security"
)

// Store 把 settings/secrets/admin/session/audit 的包级函数收敛为接口实现，
// 供 service 通过 SettingsStore / AdminStore 接口依赖（不绑定具体 SQLite）。
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

// ---- settings / secrets ----

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

func (s *Store) ResetAllTables() error {
	return ResetAllTables(s.db)
}

func (s *Store) SettingsVersion() int {
	return SettingsVersion(s.db)
}

// ---- admin / session / audit ----

func (s *Store) HasAdmin() bool {
	return HasAdmin(s.db)
}

func (s *Store) SeedAdmin(username, password string) (bool, error) {
	return SeedAdmin(s.db, username, password)
}

func (s *Store) AdminByUsername(username string) (int64, string, string, bool, error) {
	return AdminByUsername(s.db, username)
}

func (s *Store) AdminRole(id int64) (string, error) {
	return AdminRole(s.db, id)
}

func (s *Store) AdminUsername(id int64) (string, error) {
	return AdminUsername(s.db, id)
}

func (s *Store) AdminPasswordHash(id int64) (string, error) {
	return AdminPasswordHash(s.db, id)
}

func (s *Store) UpdateAdminAccount(id int64, username, hash string) error {
	return UpdateAdminAccount(s.db, id, username, hash)
}

func (s *Store) AdminTOTP(id int64) (bool, string, error) {
	return AdminTOTP(s.db, id)
}

func (s *Store) SetAdminTOTPSecret(id int64, secret string) error {
	return SetAdminTOTPSecret(s.db, id, secret)
}

func (s *Store) SetAdminTOTPEnabled(id int64, enabled bool) error {
	return SetAdminTOTPEnabled(s.db, id, enabled)
}

func (s *Store) ListAdmins() ([]models.AdminRow, error) {
	return ListAdmins(s.db)
}

func (s *Store) AdminCountByRole(role string) (int, error) {
	return AdminCountByRole(s.db, role)
}

func (s *Store) CreateAdmin(username, passwordHash, role string) error {
	return CreateAdmin(s.db, username, passwordHash, role)
}

func (s *Store) SetAdminRoleGuarded(id int64, role string) error {
	return SetAdminRoleGuarded(s.db, id, role)
}

func (s *Store) DeleteAdmin(id int64) error {
	return DeleteAdmin(s.db, id)
}

func (s *Store) CreateSession(id string, adminID int64, expiresAt int64) error {
	return CreateSession(s.db, id, adminID, expiresAt)
}

func (s *Store) SessionAdminID(id string) (int64, int64, error) {
	return SessionAdminID(s.db, id)
}

func (s *Store) SlideSessionExpiry(id string, expiresAt int64) error {
	return SlideSessionExpiry(s.db, id, expiresAt)
}

func (s *Store) DeleteSession(id string) error {
	return DeleteSession(s.db, id)
}

func (s *Store) DeleteSessionsByAdmin(adminID int64) error {
	return DeleteSessionsByAdmin(s.db, adminID)
}

func (s *Store) DeleteAllSessions() error {
	return DeleteAllSessions(s.db)
}

func (s *Store) EnsureSessionSecret() string {
	return EnsureSessionSecret(s.db)
}

func (s *Store) AddAuditLog(adminID int64, username, action, targetType, targetID, before, after string) error {
	return AddAuditLog(s.db, adminID, username, action, targetType, targetID, before, after)
}

func (s *Store) AuditLogs(limit int) ([]models.AuditLog, error) {
	return AuditLogs(s.db, limit)
}

// ---- jobs ----

func (s *Store) LatestJobRuns() ([]models.JobRun, error) {
	return LatestJobRuns(s.db)
}

func (s *Store) PendingMailCount() (int, error) {
	return PendingMailCount(s.db)
}
