package jobs

import (
	"database/sql"
	"log"
	"time"

	"shop/internal/db"
)

// EmailRetryJob 重试发送失败的邮件（指数退避，最多 5 次）。
// send 由调用方注入（notifier.SendRawMail），避免 jobs ↔ notify 循环依赖。
func EmailRetryJob(d *sql.DB, send func(to, subject, body string) error) func() {
	return func() {
		items, err := db.DueMails(d, time.Now().Unix())
		if err != nil {
			log.Printf("job email_retry: %v", err)
			return
		}
		for _, m := range items {
			if err := send(m.To, m.Subject, m.Body); err != nil {
				next := time.Now().Add(time.Duration(1<<(m.Attempts+1)) * time.Minute).Unix()
				if rerr := db.MarkMailRetry(d, m.ID, next); rerr != nil {
					log.Printf("job email_retry: mark retry %d: %v", m.ID, rerr)
				}
				continue
			}
			if err := db.MarkMailSent(d, m.ID); err != nil {
				log.Printf("job email_retry: mark sent %d: %v", m.ID, err)
			}
		}
	}
}
