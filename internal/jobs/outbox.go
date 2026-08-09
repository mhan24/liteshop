package jobs

import (
	"database/sql"
	"time"

	"shop/internal/db/repository"
	"shop/internal/events"
	"shop/internal/logging"
)

// OutboxPublishJob 读取 outbox 并发布领域事件（Outbox 模式消费者）。
// 事件与订单状态同事务写入；此处发布 + 标记 sent；连续失败超过上限进入 dead_events。
func OutboxPublishJob(d *sql.DB, pub events.Publisher) func() error {
	return func() error {
		items, err := repository.FetchOutboxEvents(d, 50)
		if err != nil {
			logging.App().Sugar().Errorf("job outbox fetch: %v", err)
			return err
		}
		published := 0
		for _, item := range items {
			if err := publishOne(d, pub, item); err != nil {
				if err := failOne(d, item); err != nil {
					logging.App().Sugar().Errorf("job outbox fail id=%d: %v", item.ID, err)
					return err
				}
				continue
			}
			published++
		}
		if published > 0 {
			logging.App().Sugar().Infof("job outbox_publish: published %d events", published)
		}
		return nil
	}
}

// publishOne 发布单条事件：解码 → 分发 → 标记 sent。
func publishOne(d *sql.DB, pub events.Publisher, item repository.OutboxEvent) error {
	e, err := events.Decode(item.Payload)
	if err != nil {
		return err
	}
	pub.Publish(e)
	if err := repository.MarkOutboxPublished(d, item.ID, time.Now().Unix()); err != nil {
		return err
	}
	return nil
}

// failOne 处理一次失败：达到上限进死信，否则 attempts+1 等待重试。
func failOne(d *sql.DB, item repository.OutboxEvent) error {
	attempts := item.Attempts + 1
	logging.App().Sugar().Errorf("job outbox failed id=%d type=%s attempts=%d/%d", item.ID, item.EventType, attempts, repository.MaxOutboxAttempts)
	if attempts >= repository.MaxOutboxAttempts {
		if err := repository.MoveOutboxToDead(d, item.ID, "outbox attempts exhausted"); err != nil {
			return err
		}
		logging.App().Sugar().Errorf("job outbox moved to dead_events id=%d type=%s", item.ID, item.EventType)
		return nil
	}
	if err := repository.MarkOutboxFailed(d, item.ID); err != nil {
		return err
	}
	return nil
}
