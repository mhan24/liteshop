package jobs

import (
	"errors"
	"testing"
	"time"

	"shop/internal/db"
	"shop/internal/db/repository"
)

func TestEmailRetryJob(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	if err := repository.EnqueueMail(d, "a@b.com", "S", "B", 0, time.Now().Unix()); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	// 失败 → attempts+1，排入下次重试
	fail := func(to, subject, body string) error { return errors.New("smtp down") }
	EmailRetryJob(d, fail)()
	var attempts int
	_ = d.QueryRow(`SELECT attempts FROM mail_queue WHERE to_email='a@b.com'`).Scan(&attempts)
	if attempts != 1 {
		t.Fatalf("attempts = %d, want 1", attempts)
	}
	// 成功 → 从队列删除
	_, _ = d.Exec(`UPDATE mail_queue SET next_retry_at = 0`)
	ok := func(to, subject, body string) error { return nil }
	EmailRetryJob(d, ok)()
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM mail_queue`).Scan(&n)
	if n != 0 {
		t.Fatalf("queue rows = %d, want 0", n)
	}
}
