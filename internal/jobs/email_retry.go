package jobs

import (
	"database/sql"
	"time"

	"shop/internal/db/repository"

	"shop/internal/logging"
)

// EmailRetryJob 重试发送失败的邮件（指数退避，最多 5 次）。
// send 由调用方注入（notifier.SendRawMail），避免 jobs ↔ notify 循环依赖。
func EmailRetryJob(d *sql.DB, send func(to, subject, body string) error) func() error {
	return func() error {
		items, err := repository.DueMails(d, time.Now().Unix())
		if err != nil {
			logging.App().Sugar().Errorf("job email_retry: %v", err)
			return err
		}
		for _, m := range items {
			if err := send(m.To, m.Subject, m.Body); err != nil {
				next := time.Now().Add(time.Duration(1<<(m.Attempts+1)) * time.Minute).Unix()
				if rerr := repository.MarkMailRetry(d, m.ID, next); rerr != nil {
					logging.App().Sugar().Errorf("job email_retry: mark retry %d: %v", m.ID, rerr)
				}
				continue
			}
			if err := repository.MarkMailSent(d, m.ID); err != nil {
				logging.App().Sugar().Errorf("job email_retry: mark sent %d: %v", m.ID, err)
			}
		}
		return nil
	}
}
