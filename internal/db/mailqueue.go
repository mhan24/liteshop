package db

import (
	"database/sql"

	"shop/internal/models"
)

// MailItem 一条待发送/重试邮件。
type MailItem struct {
	ID          int64
	To          string
	Subject     string
	Body        string
	OrderID     int64
	Attempts    int
	NextRetryAt int64
}

// EnqueueMail 写入邮件队列（发送失败后重试）。
func EnqueueMail(d *sql.DB, to, subject, body string, orderID int64, retryAt int64) error {
	_, err := d.Exec(`INSERT INTO mail_queue(to_email, subject, body, order_id, attempts, next_retry_at, created_at)
		VALUES(?, ?, ?, ?, 0, ?, ?)`, to, subject, body, orderID, retryAt, models.Now())
	return err
}

// DueMails 返回到期需发送的邮件（上限 50，含失败次数未超限的）。
func DueMails(d *sql.DB, now int64) ([]MailItem, error) {
	rows, err := d.Query(`SELECT id, to_email, subject, body, order_id, attempts, next_retry_at
		FROM mail_queue WHERE next_retry_at <= ? AND attempts < 5 ORDER BY id LIMIT 50`, now)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []MailItem
	for rows.Next() {
		var m MailItem
		if err := rows.Scan(&m.ID, &m.To, &m.Subject, &m.Body, &m.OrderID, &m.Attempts, &m.NextRetryAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// MarkMailSent 发送成功后删除队列项。
func MarkMailSent(d *sql.DB, id int64) error {
	_, err := d.Exec(`DELETE FROM mail_queue WHERE id = ?`, id)
	return err
}

// MarkMailRetry 发送失败：次数 +1，下次重试时间按退避计算；超过上限则丢弃。
func MarkMailRetry(d *sql.DB, id int64, nextRetryAt int64) error {
	_, err := d.Exec(`UPDATE mail_queue SET attempts = attempts + 1, next_retry_at = ? WHERE id = ? AND attempts < 5`, nextRetryAt, id)
	if err != nil {
		return err
	}
	_, err = d.Exec(`DELETE FROM mail_queue WHERE id = ? AND attempts >= 5`, id)
	return err
}
