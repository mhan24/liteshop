package db

import (
	"testing"

	"shop/internal/db/repository"
	"shop/internal/models"
)

func TestDeleteOldOutboxEvents(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := models.Now()
	// 已发布 40 天前（应删）、已发布 1 天前（保留）、未发布 40 天前（必须保留，待送达）
	for _, row := range []struct {
		publishedAt int64
		createdAt   int64
	}{
		{now - 40*86400, now - 40*86400},
		{now - 86400, now - 86400},
		{0, now - 40*86400},
	} {
		if _, err := d.Exec(`INSERT INTO outbox_events(event_type, payload, created_at, published_at)
			VALUES('order.paid', '{}', ?, ?)`, row.createdAt, row.publishedAt); err != nil {
			t.Fatalf("insert: %v", err)
		}
	}
	if err := repository.DeleteOldOutboxEvents(d, now-30*86400); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM outbox_events`).Scan(&n)
	if n != 2 {
		t.Fatalf("rows after cleanup = %d, want 2 (recent published + unpublished kept)", n)
	}
}
