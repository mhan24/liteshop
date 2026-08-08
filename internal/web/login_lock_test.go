package web

import (
	"testing"
	"time"
)

func TestLoginLockout(t *testing.T) {
	s := &Server{loginFails: map[string]loginGuard{}}
	u := "admin"
	for i := 0; i < 4; i++ {
		s.recordLoginFail(u)
		if s.loginLocked(u) {
			t.Fatalf("locked too early at fail %d", i+1)
		}
	}
	s.recordLoginFail(u)
	if !s.loginLocked(u) {
		t.Fatal("should be locked after 5 consecutive fails")
	}
	s.clearLoginFails(u)
	if s.loginLocked(u) {
		t.Fatal("should unlock after clear")
	}
	// 锁定到期后自动解锁
	for i := 0; i < 5; i++ {
		s.recordLoginFail(u)
	}
	g := s.loginFails[u]
	g.lockedUntil = time.Now().Unix() - 1
	s.loginFails[u] = g
	if s.loginLocked(u) {
		t.Fatal("should unlock after lock expiry")
	}
}
