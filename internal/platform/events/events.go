// Package events 提供业务无关的事件发布基础设施（Publisher / Fanout）。
// 领域事件类型定义在各自业务模块，平台层不感知业务语义。
package events

import "fmt"

// Event 领域事件统一接口（由业务模块实现 EventName）。
type Event interface {
	EventName() string
}

// Publisher 领域事件发布器（由装配层注入实现）。
type Publisher interface {
	Publish(e Event)
}

// Func 把普通函数适配为 Publisher。
type Func func(e Event)

func (f Func) Publish(e Event) { f(e) }

// Consumer 一个独立的事件消费者，互不影响。
type Consumer struct {
	Name   string
	Handle func(Event)
}

// Fanout 事件扇出：每个消费者独立 goroutine + panic 隔离。
type Fanout struct {
	consumers []Consumer
	onPanic   func(name string, r any)
}

// PublishSync 同步执行消费者，等待每个消费者完成；panic 转为错误。
// Outbox 使用该入口，只有事件被所有消费者可靠接收后才可确认 sent。
func (f *Fanout) PublishSync(e Event) (err error) {
	for _, c := range f.consumers {
		func(c Consumer) {
			defer func() {
				if r := recover(); r != nil {
					if f.onPanic != nil {
						f.onPanic(c.Name, r)
					}
					err = fmt.Errorf("event consumer %s panic: %v", c.Name, r)
				}
			}()
			c.Handle(e)
		}(c)
		if err != nil {
			return err
		}
	}
	return nil
}

func NewFanout(consumers ...Consumer) *Fanout {
	return &Fanout{consumers: consumers}
}

// SetPanicHandler 设置消费者 panic 回调（如写日志）。
func (f *Fanout) SetPanicHandler(fn func(name string, r any)) {
	f.onPanic = fn
}

func (f *Fanout) Publish(e Event) {
	for _, c := range f.consumers {
		go func(c Consumer) {
			defer func() {
				if r := recover(); r != nil && f.onPanic != nil {
					f.onPanic(c.Name, r)
				}
			}()
			c.Handle(e)
		}(c)
	}
}
