package mailqueue

import (
	"context"
	"database/sql"
	"time"

	"shop/internal/platform/logging"
)

// RetryService 邮件重试用例：重试策略（指数退避、失败上限）归此处，任务只负责触发。
type RetryService struct {
	db   *sql.DB
	send func(to, subject, body string) error
}

func NewRetryService(db *sql.DB, send func(to, subject, body string) error) *RetryService {
	return &RetryService{db: db, send: send}
}

// RetryDue 发送到期的待重试邮件（指数退避 1<<(attempts+1) 分钟，最多 5 次）。
func (s *RetryService) RetryDue(ctx context.Context, now int64) error {
	if s.send == nil {
		return nil
	}
	items, err := DueMails(s.db, now)
	if err != nil {
		logging.App().Sugar().Errorf("mail retry: fetch due: %v", err)
		return err
	}
	for _, m := range items {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := s.send(m.To, m.Subject, m.Body); err != nil {
			next := time.Now().Add(time.Duration(1<<(m.Attempts+1)) * time.Minute).Unix()
			if rerr := MarkMailRetry(s.db, m.ID, next); rerr != nil {
				logging.App().Sugar().Errorf("mail retry: mark retry %d: %v", m.ID, rerr)
			}
			continue
		}
		if err := MarkMailSent(s.db, m.ID); err != nil {
			logging.App().Sugar().Errorf("mail retry: mark sent %d: %v", m.ID, err)
		}
	}
	return nil
}
