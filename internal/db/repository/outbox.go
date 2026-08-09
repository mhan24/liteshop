package repository

import (
	"database/sql"

	"shop/internal/models"
)

// MaxOutboxAttempts 事件连续处理失败上限，超过进入死信。
const MaxOutboxAttempts = 5

// OutboxEvent 一条待发布/已发布的领域事件。
type OutboxEvent struct {
	ID          int64
	EventType   string
	Payload     string
	CreatedAt   int64
	PublishedAt int64
	Attempts    int
	Status      string // pending / sent / dead
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
	rows, err := d.Query(`SELECT id, event_type, payload, created_at, published_at, attempts, status
		FROM outbox_events WHERE status = 'pending' AND published_at = 0 ORDER BY id LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []OutboxEvent{}
	for rows.Next() {
		var e OutboxEvent
		if err := rows.Scan(&e.ID, &e.EventType, &e.Payload, &e.CreatedAt, &e.PublishedAt, &e.Attempts, &e.Status); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// MarkOutboxPublished 标记事件已发布（消费成功后调用；失败可重试，处理器幂等）。
func MarkOutboxPublished(d *sql.DB, id int64, publishedAt int64) error {
	_, err := d.Exec(`UPDATE outbox_events SET published_at = ?, status = 'sent' WHERE id = ? AND status = 'pending'`,
		publishedAt, id)
	return err
}

// MarkOutboxFailed 记录一次处理失败（attempts+1，仍为 pending 等待重试）。
func MarkOutboxFailed(d *sql.DB, id int64) error {
	_, err := d.Exec(`UPDATE outbox_events SET attempts = attempts + 1 WHERE id = ? AND status = 'pending'`, id)
	return err
}

// MoveOutboxToDead 连续失败进入死信表（dead_events），事件置 dead 停止重试。
func MoveOutboxToDead(d *sql.DB, id int64, reason string) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err := tx.Exec(`INSERT INTO dead_events(event_type, payload, created_at, dead_at, reason)
		SELECT event_type, payload, created_at, ?, ? FROM outbox_events WHERE id = ?`,
		models.Now(), reason, id); err != nil {
		return err
	}
	if _, err := tx.Exec(`UPDATE outbox_events SET status = 'dead' WHERE id = ? AND status = 'pending'`, id); err != nil {
		return err
	}
	return tx.Commit()
}

// DeadEventCount 返回死信事件数量。
func DeadEventCount(d *sql.DB) (int, error) {
	var n int
	err := d.QueryRow(`SELECT COUNT(1) FROM dead_events`).Scan(&n)
	return n, err
}

// DeleteOldOutboxEvents 清理已发布且超过保留期的 outbox 记录（未发布的一律保留，必须送达）。
func DeleteOldOutboxEvents(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM outbox_events WHERE published_at != 0 AND published_at < ?`, cutoff)
	return err
}
