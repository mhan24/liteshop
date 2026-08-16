package outbox

import (
	"context"
	"database/sql"
	"time"

	"shop/internal/platform/logging"
)

// OutboxService outbox 投递用例：读取待发布载荷 → 交给 deliver（组合根解码/分发）→ 标记 sent；
// 连续失败超过上限进入死信。平台不感知载荷语义。任务只负责触发。
type OutboxService struct {
	db *sql.DB
}

func NewOutboxService(db *sql.DB) *OutboxService {
	return &OutboxService{db: db}
}

// PublishPending 投递待处理事件（每次最多 50 条）。
// deliver 由组合根提供：负责把载荷解码为领域事件并分发。
func (s *OutboxService) PublishPending(ctx context.Context, deliver func(payload string) error) error {
	items, err := FetchOutboxEvents(s.db, 50)
	if err != nil {
		logging.App().Sugar().Errorf("outbox fetch: %v", err)
		return err
	}
	published := 0
	for _, item := range items {
		select {
		case <-ctx.Done():
			return ctx.Err()
		default:
		}
		if err := s.publishOne(ctx, deliver, item); err != nil {
			if err := failOne(s.db, item); err != nil {
				logging.App().Sugar().Errorf("outbox fail id=%d: %v", item.ID, err)
				return err
			}
			continue
		}
		published++
	}
	if published > 0 {
		logging.App().Sugar().Infof("outbox published %d events", published)
	}
	return nil
}

func (s *OutboxService) publishOne(_ context.Context, deliver func(payload string) error, item OutboxEvent) error {
	if err := deliver(item.Payload); err != nil {
		return err
	}
	return MarkOutboxPublished(s.db, item.ID, time.Now().Unix())
}

// failOne 处理一次失败：达到上限进死信，否则 attempts+1 等待重试。
func failOne(d *sql.DB, item OutboxEvent) error {
	attempts := item.Attempts + 1
	logging.App().Sugar().Errorf("outbox failed id=%d type=%s attempts=%d/%d", item.ID, item.EventType, attempts, MaxOutboxAttempts)
	if attempts >= MaxOutboxAttempts {
		if err := MoveOutboxToDead(d, item.ID, "outbox attempts exhausted"); err != nil {
			return err
		}
		logging.App().Sugar().Errorf("outbox moved to dead_events id=%d type=%s", item.ID, item.EventType)
		return nil
	}
	return MarkOutboxFailed(d, item.ID)
}
