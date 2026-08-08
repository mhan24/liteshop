// Package task 提供进程内异步任务系统（goroutine + channel，无 MQ）。
// HTTP 层只发布事件，worker 消费执行（邮件/Telegram/Webhook 等）。
package jobs

import (
	"context"

	"shop/internal/models"

	"shop/internal/logging"
)

// 任务类型。
const (
	KindPaid     = "paid_notify" // 发卡通知（邮件 + Telegram）
	KindMail     = "mail"
	KindTelegram = "telegram"
	KindWebhook  = "webhook"
)

// Job 一条异步任务。
type Job struct {
	Kind    string
	Order   models.Order
	Cards   []models.Card
	To      string
	Subject string
	Body    string
	Text    string
	Event   string
	Payload map[string]string
}

// Bus 内存任务总线。
type Bus struct {
	ch chan Job
}

// NewBus 创建任务总线。
func NewBus(queueSize int) *Bus {
	if queueSize <= 0 {
		queueSize = 1024
	}
	return &Bus{ch: make(chan Job, queueSize)}
}

// Publish 发布任务；队列满时丢弃并记日志（避免阻塞 HTTP 请求）。
func (b *Bus) Publish(j Job) {
	select {
	case b.ch <- j:
	default:
		logging.App().Sugar().Warnf("task: queue full, dropped job kind=%s", j.Kind)
	}
}

// Start 启动 workers 消费任务，直到 ctx 取消。
func (b *Bus) Start(ctx context.Context, workers int, handle func(Job)) {
	if workers <= 0 {
		workers = 1
	}
	for i := 0; i < workers; i++ {
		go func() {
			for {
				select {
				case <-ctx.Done():
					return
				case j := <-b.ch:
					handle(j)
				}
			}
		}()
	}
}
