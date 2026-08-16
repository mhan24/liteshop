package sqlite

import (
	"database/sql"

	"shop/internal/modules/admin/domain"
	mailqueue "shop/internal/platform/mailqueue"
	outbox "shop/internal/platform/outbox"
)

// Store 实现 admin/application.AdminStore / JobsStore / StatsStore。
type Store struct {
	db *sql.DB
}

func NewStore(db *sql.DB) *Store {
	return &Store{db: db}
}

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

func (s *Store) ListAdmins() ([]domain.AdminRow, error) {
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

func (s *Store) DeleteExpiredSessions(now int64) error {
	return DeleteExpiredSessions(s.db, now)
}

func (s *Store) DeleteOldJobRuns(cutoff int64) error {
	return DeleteOldJobRuns(s.db, cutoff)
}

func (s *Store) LatestJobRuns() ([]domain.JobRun, error) {
	return LatestJobRuns(s.db)
}

func (s *Store) PendingMailCount() (int, error) {
	return mailqueue.PendingMailCount(s.db)
}

func (s *Store) DeadEventCount() (int, error) {
	return outbox.DeadEventCount(s.db)
}

func (s *Store) SchemaVersion() int {
	var n int
	_ = s.db.QueryRow(`SELECT COUNT(1) FROM schema_migrations`).Scan(&n)
	return n
}

func (s *Store) IntegrityOK() bool {
	var result string
	if err := s.db.QueryRow(`PRAGMA integrity_check`).Scan(&result); err != nil {
		return false
	}
	return result == "ok"
}
