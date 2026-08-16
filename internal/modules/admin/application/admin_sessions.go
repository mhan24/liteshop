package application

// ---- 会话 ----

func (s *AdminService) CreateSession(id string, adminID int64, expiresAt int64) error {
	return s.store.CreateSession(id, adminID, expiresAt)
}

func (s *AdminService) SessionAdminID(id string) (int64, int64, error) {
	return s.store.SessionAdminID(id)
}

func (s *AdminService) SlideSession(id string, expiresAt int64) error {
	return s.store.SlideSessionExpiry(id, expiresAt)
}

func (s *AdminService) DeleteSession(id string) error {
	return s.store.DeleteSession(id)
}

func (s *AdminService) DeleteSessionsByAdmin(adminID int64) error {
	return s.store.DeleteSessionsByAdmin(adminID)
}

func (s *AdminService) DeleteAllSessions() error {
	return s.store.DeleteAllSessions()
}
