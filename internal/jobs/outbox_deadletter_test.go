package jobs

import (
	"testing"

	"shop/internal/db"
	"shop/internal/db/repository"
	"shop/internal/events"
	"shop/internal/models"
)

// TestOutboxDeadLetter 连续失败进入死信：损坏载荷重试 5 次后置 dead，
// 不再无限重试；正常载荷发布后置 sent。
func TestOutboxDeadLetter(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := models.Now()
	// 损坏载荷（会解码失败）
	if _, err := d.Exec(`INSERT INTO outbox_events(event_type, payload, created_at) VALUES('order.paid', 'not-json', ?)`, now); err != nil {
		t.Fatalf("insert bad: %v", err)
	}
	// 正常载荷
	good, err := events.Encode(events.OrderPaidEvent{})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO outbox_events(event_type, payload, created_at) VALUES('order.paid', ?, ?)`, good, now); err != nil {
		t.Fatalf("insert good: %v", err)
	}

	var published int
	pub := events.Func(func(events.Event) { published++ })
	job := OutboxPublishJob(d, pub)
	// 重试 5 次：损坏事件在第 5 次进入死信；正常事件第一次即发布
	for i := 0; i < repository.MaxOutboxAttempts; i++ {
		if err := job(); err != nil {
			t.Fatalf("run %d: %v", i+1, err)
		}
	}
	if published != 1 {
		t.Fatalf("published = %d, want 1 (good event only)", published)
	}
	dead, err := repository.DeadEventCount(d)
	if err != nil || dead != 1 {
		t.Fatalf("dead events = %d (%v), want 1", dead, err)
	}
	pending, err := repository.FetchOutboxEvents(d, 10)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending = %d (%v), want 0", len(pending), err)
	}
	var deadStatus string
	_ = d.QueryRow(`SELECT status FROM outbox_events WHERE payload='not-json'`).Scan(&deadStatus)
	if deadStatus != "dead" {
		t.Fatalf("corrupt event status = %q, want dead", deadStatus)
	}
}
