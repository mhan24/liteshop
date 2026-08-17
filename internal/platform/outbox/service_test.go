package outbox

import (
	"context"

	orderapp "shop/internal/modules/order/application"
	"testing"

	db "shop/internal/platform/database/sqlite"
	"shop/internal/shared/clock"
)

// TestOutboxDeadLetter 连续失败进入死信：损坏载荷重试 5 次后置 dead，
// 不再无限重试；正常载荷发布后置 sent。
func TestOutboxDeadLetter(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/t.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := clock.Now()
	if _, err := d.Exec(`INSERT INTO outbox_events(event_type, payload, created_at) VALUES('order.paid', 'not-json', ?)`, now); err != nil {
		t.Fatalf("insert bad: %v", err)
	}
	good, err := orderapp.EncodeEvent(orderapp.OrderPaidEvent{})
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	if _, err := d.Exec(`INSERT INTO outbox_events(event_type, payload, created_at) VALUES('order.paid', ?, ?)`, good, now); err != nil {
		t.Fatalf("insert good: %v", err)
	}

	var published int
	svc := NewOutboxService(d)
	deliver := func(payload string) error {
		e, err := orderapp.DecodeEvent(payload)
		if err != nil {
			return err
		}
		_ = e
		published++
		return nil
	}
	for i := 0; i < MaxOutboxAttempts; i++ {
		if err := svc.PublishPending(context.Background(), deliver); err != nil {
			t.Fatalf("run %d: %v", i+1, err)
		}
	}
	if published != 1 {
		t.Fatalf("published = %d, want 1 (good event only)", published)
	}
	dead, err := DeadEventCount(d)
	if err != nil || dead != 1 {
		t.Fatalf("dead events = %d (%v), want 1", dead, err)
	}
	pending, err := FetchOutboxEvents(d, 10)
	if err != nil || len(pending) != 0 {
		t.Fatalf("pending = %d (%v), want 0", len(pending), err)
	}
	var deadStatus string
	_ = d.QueryRow(`SELECT status FROM outbox_events WHERE payload='not-json'`).Scan(&deadStatus)
	if deadStatus != "dead" {
		t.Fatalf("corrupt event status = %q, want dead", deadStatus)
	}
}
