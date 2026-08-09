package repository

import (
	"database/sql"

	"shop/internal/models"
)

// OutboxEvent 一条待发布/已发布的领域事件。
type OutboxEvent struct {
	ID          int64
	EventType   string
	Payload     string
	CreatedAt   int64
	PublishedAt int64
}

// enqueueOutboxTx 在既有事务内写入 outbox（与订单状态变更同事务，崩溃不丢事件）。
func enqueueOutboxTx(tx *sql.Tx, eventType, payload string) error {
	_, err := tx.Exec(`INSERT INTO outbox_events(event_type, payload, created_at) VALUES(?, ?, ?)`,
		eventType, payload, models.Now())
	return err
}

// FetchOutboxEvents 返回待发布事件（published_at=0，按序，上限 limit）。
func FetchOutboxEvents(d *sql.DB, limit int) ([]OutboxEvent, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := d.Query(`SELECT id, event_type, payload, created_at, published_at
		FROM outbox_events WHERE published_at = 0 ORDER BY id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OutboxEvent{}
	for rows.Next() {
		var e OutboxEvent
		if err := rows.Scan(&e.ID, &e.EventType, &e.Payload, &e.CreatedAt, &e.PublishedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// MarkOutboxPublished 标记事件已发布（消费成功后调用；失败可重试，处理器幂等）。
func MarkOutboxPublished(d *sql.DB, id int64, publishedAt int64) error {
	_, err := d.Exec(`UPDATE outbox_events SET published_at = ? WHERE id = ? AND published_at = 0`,
		publishedAt, id)
	return err
}

// DeleteOldOutboxEvents 清理已发布且超过保留期的 outbox 记录（未发布的一律保留，必须送达）。
func DeleteOldOutboxEvents(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM outbox_events WHERE published_at != 0 AND published_at < ?`, cutoff)
	return err
}
