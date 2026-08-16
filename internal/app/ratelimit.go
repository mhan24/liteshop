package app

import (
	"fmt"
	"net/http"
	"sync"
	"time"
)

type visitor struct {
	count       int
	windowStart time.Time
}

type RateLimiter struct {
	mu       sync.Mutex
	visitors map[string]*visitor
	limit    int
	window   time.Duration
}

func NewRateLimiter(limit int, window time.Duration) *RateLimiter {
	return &RateLimiter{
		visitors: make(map[string]*visitor),
		limit:    limit,
		window:   window,
	}
}

func (rl *RateLimiter) Allow(ip string) bool {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	v, exists := rl.visitors[ip]
	if !exists || now.Sub(v.windowStart) > rl.window {
		rl.visitors[ip] = &visitor{count: 1, windowStart: now}
		return true
	}
	v.count++
	return v.count <= rl.limit
}

func (rl *RateLimiter) Cleanup() {
	rl.mu.Lock()
	defer rl.mu.Unlock()
	now := time.Now()
	for ip, v := range rl.visitors {
		if now.Sub(v.windowStart) > rl.window*2 {
			delete(rl.visitors, ip)
		}
	}
}

func (s *Server) rateLimitMiddleware(name string, limit int, next http.HandlerFunc) http.HandlerFunc {
	key := fmt.Sprintf("%s-%d", name, limit)
	s.limitersMu.Lock()
	rl, exists := s.limiters[key]
	if !exists {
		rl = NewRateLimiter(limit, time.Minute)
		s.limiters[key] = rl
	}
	s.limitersMu.Unlock()
	return func(w http.ResponseWriter, r *http.Request) {
		ip := clientIP(r)
		if !rl.Allow(ip) {
			writeJSON(w, http.StatusTooManyRequests, map[string]any{"error": "请求过于频繁，请稍后再试"})
			return
		}
		next(w, r)
	}
}

// cleanupLimiters 定期清理所有限流器中的过期 visitor，防止内存增长。
func (s *Server) cleanupLimiters() {
	s.limitersMu.Lock()
	defer s.limitersMu.Unlock()
	for _, rl := range s.limiters {
		rl.Cleanup()
	}
}
