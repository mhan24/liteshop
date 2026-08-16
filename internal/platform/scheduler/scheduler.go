package scheduler

import (
	"context"
	"fmt"
	"sync"
	"time"

	"shop/internal/platform/logging"
)

// Job 一个周期任务。
type ScheduledJob struct {
	Name       string
	Interval   time.Duration
	RunOnStart bool // 启动后立即执行一次（崩溃补偿，如订单过期/邮件重试）
	Run        func(ctx context.Context) error
}

// Scheduler 周期任务调度器（Go ticker，无需 MQ）。
type Scheduler struct {
	mu       sync.Mutex
	jobs     []ScheduledJob
	recorder func(name string, startedAt, finishedAt int64, err error)
}

func NewScheduler() *Scheduler {
	return &Scheduler{}
}

// Add 注册周期任务；runOnStart=true 时启动后立即执行一次。
func (s *Scheduler) Add(name string, interval time.Duration, runOnStart bool, run func(ctx context.Context) error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.jobs = append(s.jobs, ScheduledJob{Name: name, Interval: interval, RunOnStart: runOnStart, Run: run})
}

// SetRecorder 设置任务执行记录器（写入 job_runs 等），可为 nil。
func (s *Scheduler) SetRecorder(fn func(name string, startedAt, finishedAt int64, err error)) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recorder = fn
}

// record 记录一次任务执行结果（started/finished/status/error）。
func (s *Scheduler) record(name string, startedAt int64, err error) {
	if s.recorder == nil {
		return
	}
	s.recorder(name, startedAt, time.Now().Unix(), err)
}

// runOnce 执行一次任务（含 panic 捕获），并记录执行结果。
func (s *Scheduler) runOnce(name string, ctx context.Context, run func(ctx context.Context) error) {
	startedAt := time.Now().Unix()
	err := func() (e error) {
		defer func() {
			if r := recover(); r != nil {
				e = fmt.Errorf("panic: %v", r)
			}
		}()
		return run(ctx)
	}()
	if err != nil {
		logging.App().Sugar().Errorf("job %s failed: %v", name, err)
	}
	s.record(name, startedAt, err)
}

// Start 启动所有周期任务，直到 ctx 取消。
func (s *Scheduler) Start(ctx context.Context) {
	s.mu.Lock()
	jobs := append([]ScheduledJob(nil), s.jobs...)
	s.mu.Unlock()
	for _, j := range jobs {
		go func(j ScheduledJob) {
			// 非法间隔（<=0）会导致 time.NewTicker panic，启动时直接跳过并告警。
			if j.Interval <= 0 {
				logging.App().Sugar().Errorf("job %s: invalid interval %v, skipped", j.Name, j.Interval)
				return
			}
			if j.RunOnStart {
				logging.App().Sugar().Infof("job %s: startup run", j.Name)
				s.runOnce(j.Name, ctx, j.Run)
			}
			ticker := time.NewTicker(j.Interval)
			defer ticker.Stop()
			for {
				select {
				case <-ctx.Done():
					return
				case <-ticker.C:
					s.runOnce(j.Name, ctx, j.Run)
				}
			}
		}(j)
	}
}
