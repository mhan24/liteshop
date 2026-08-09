package service

import "shop/internal/db/repository"

// ---- 会话 ----

func (s *AdminService) CreateSession(id string, adminID int64, expiresAt int64) error {
	return repository.CreateSession(s.db, id, adminID, expiresAt)
}

func (s *AdminService) SessionAdminID(id string) (int64, int64, error) {
	return repository.SessionAdminID(s.db, id)
}

func (s *AdminService) SlideSession(id string, expiresAt int64) error {
	return repository.SlideSessionExpiry(s.db, id, expiresAt)
}

func (s *AdminService) DeleteSession(id string) error {
	return repository.DeleteSession(s.db, id)
}

func (s *AdminService) DeleteSessionsByAdmin(adminID int64) error {
	return repository.DeleteSessionsByAdmin(s.db, adminID)
}

func (s *AdminService) DeleteAllSessions() error {
	return repository.DeleteAllSessions(s.db)
}

// SessionSecret 返回会话主密钥（缺失时生成并写入）。
func (s *AdminService) SessionSecret() string {
	return repository.EnsureSessionSecret(s.db)
}
