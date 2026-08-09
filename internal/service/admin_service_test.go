package service

import (
	"testing"
	"time"
)

func TestLoginLockout(t *testing.T) {
	s := &AdminService{loginFails: map[string]loginGuard{}}
	u := "1.2.3.4|admin"
	for i := 0; i < 4; i++ {
		s.RecordLoginFail(u)
		if s.LoginLocked(u) {
			t.Fatalf("locked too early at fail %d", i+1)
		}
	}
	s.RecordLoginFail(u)
	if !s.LoginLocked(u) {
		t.Fatal("should be locked after 5 consecutive fails")
	}
	s.ClearLoginFails(u)
	if s.LoginLocked(u) {
		t.Fatal("should unlock after clear")
	}
	// 锁定到期后自动解锁
	for i := 0; i < 5; i++ {
		s.RecordLoginFail(u)
	}
	g := s.loginFails[u]
	g.lockedUntil = time.Now().Unix() - 1
	s.loginFails[u] = g
	if s.LoginLocked(u) {
		t.Fatal("should unlock after lock expiry")
	}
}
