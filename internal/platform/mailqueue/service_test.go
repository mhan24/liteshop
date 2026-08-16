package mailqueue

import (
	"context"
	"errors"
	"testing"
	"time"

	db "shop/internal/platform/database/sqlite"
)

// TestRetryService 重试用例：失败 attempts+1 排入下次，成功出队。
func TestRetryService(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	if err := EnqueueMail(d, "a@b.com", "S", "B", 0, time.Now().Unix()); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	svc := NewRetryService(d, func(to, subject, body string) error { return errors.New("smtp down") })
	if err := svc.RetryDue(context.Background(), time.Now().Unix()); err != nil {
		t.Fatalf("retry: %v", err)
	}
	var attempts int
	_ = d.QueryRow(`SELECT attempts FROM mail_queue WHERE to_email='a@b.com'`).Scan(&attempts)
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
	_, _ = d.Exec(`UPDATE mail_queue SET next_retry_at = 0`)
	ok := NewRetryService(d, func(to, subject, body string) error { return nil })
	if err := ok.RetryDue(context.Background(), time.Now().Unix()); err != nil {
		t.Fatalf("retry ok: %v", err)
	}
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM mail_queue`).Scan(&n)
	if n != 0 {
		t.Fatalf("queue rows = %d, want 0", n)
	}
}
