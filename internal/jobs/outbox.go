package jobs

import (
	"database/sql"
	"time"

	"shop/internal/db/repository"
	"shop/internal/events"
	"shop/internal/logging"
)

// OutboxPublishJob 读取 outbox 并发布领域事件（Outbox 模式消费者）。
// 事件与订单状态同事务写入；此处发布 + 标记 published，失败可重试（处理器幂等）。
func OutboxPublishJob(d *sql.DB, pub events.Publisher) func() error {
	return func() error {
		items, err := repository.FetchOutboxEvents(d, 50)
		if err != nil {
			logging.App().Sugar().Errorf("job outbox fetch: %v", err)
			return err
		}
		published := 0
		for _, item := range items {
			e, err := events.Decode(item.Payload)
			if err != nil {
				// 载荷损坏：标记已发布避免死循环，并告警。
				logging.App().Sugar().Errorf("job outbox decode id=%d type=%s: %v", item.ID, item.EventType, err)
				_ = repository.MarkOutboxPublished(d, item.ID, time.Now().Unix())
				continue
			}
			pub.Publish(e)
			if err := repository.MarkOutboxPublished(d, item.ID, time.Now().Unix()); err != nil {
				logging.App().Sugar().Errorf("job outbox mark id=%d: %v", item.ID, err)
				return err
			}
			published++
		}
		if published > 0 {
			logging.App().Sugar().Infof("job outbox_publish: published %d events", published)
		}
		return nil
	}
}
