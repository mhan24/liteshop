package jobs

import (
	"context"
	"sync"
	"time"

	"shop/internal/logging"
)

// Job 一个周期任务。
type ScheduledJob struct {
	Name     string
	Interval time.Duration
	Run      func()
}

// Scheduler 周期任务调度器（Go ticker，无需 MQ）。
type Scheduler struct {
	mu   sync.Mutex
	jobs []ScheduledJob
}

func NewScheduler() *Scheduler {
	return &Scheduler{}
}

// Add 注册周期任务。
func (s *Scheduler) Add(name string, interval time.Duration, run func()) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs = append(s.jobs, ScheduledJob{Name: name, Interval: interval, Run: run})
}

// Start 启动所有周期任务，直到 ctx 取消。
func (s *Scheduler) Start(ctx context.Context) {
	s.mu.Lock()
	jobs := append([]ScheduledJob(nil), s.jobs...)
	s.mu.Unlock()
	for _, j := range jobs {
		go func(j ScheduledJob) {
			ticker := time.NewTicker(j.Interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					func() {
						defer func() {
							if r := recover(); r != nil {
								logging.App().Sugar().Errorf("job %s panic: %v", j.Name, r)
							}
						}()
						j.Run()
					}()
				}
			}
		}(j)
	}
}
