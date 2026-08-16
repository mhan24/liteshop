package jobs

import (
	"context"

	outbox "shop/internal/platform/outbox"
)

// OutboxPublishJob 触发器：到点调用 outbox 投递用例。
// 载荷解码/分发由组合根经 Deliver 注入，job 不感知领域语义。
type OutboxPublishJob struct {
	Service *outbox.OutboxService
	Deliver func(payload string) error
}

func (j *OutboxPublishJob) Run(ctx context.Context) error {
	return j.Service.PublishPending(ctx, j.Deliver)
}
