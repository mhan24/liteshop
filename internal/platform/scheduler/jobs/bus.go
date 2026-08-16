// Package task 提供进程内异步任务系统（goroutine + channel，无 MQ）。
// HTTP 层只发布事件，worker 消费执行（邮件/Telegram/Webhook 等）。
package jobs

import (
	"context"
	"errors"

	"shop/internal/platform/logging"
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
	Data    any // 业务载荷（发布方与消费者约定；平台不感知业务语义）
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

// QueueSize 返回当前积压任务数（健康检查指标，无需精确到个位）。
func (b *Bus) QueueSize() int {
	return len(b.ch)
}

// Publish 发布任务；队列满时丢弃并记日志（避免阻塞 HTTP 请求）。
func (b *Bus) Publish(j Job) {
	if err := b.Enqueue(j); err != nil {
		logging.App().Sugar().Warnf("task: queue full, dropped job kind=%s", j.Kind)
	}
}

// Enqueue 可靠入队接口：队列满时把错误返回给调用方，供 Outbox 保留事件并重试。
func (b *Bus) Enqueue(j Job) error {
	select {
	case b.ch <- j:
		return nil
	default:
		return errors.New("task queue full")
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
					// 单个任务 panic 只影响该 worker，不允许拖垮整个进程。
					func() {
						defer func() {
							if r := recover(); r != nil {
								logging.App().Sugar().Errorf("task worker panic kind=%s: %v", j.Kind, r)
							}
						}()
						handle(j)
					}()
				}
			}
		}()
	}
}
