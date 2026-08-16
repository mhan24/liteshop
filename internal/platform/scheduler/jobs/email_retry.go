package jobs

import (
	"context"
	"time"

	mailqueue "shop/internal/platform/mailqueue"
)

// EmailRetryJob 触发器：到点调用邮件重试用例，重试策略在 mailqueue.RetryService。
type EmailRetryJob struct {
	Service *mailqueue.RetryService
}

func (j *EmailRetryJob) Run(ctx context.Context) error {
	return j.Service.RetryDue(ctx, time.Now().Unix())
}
