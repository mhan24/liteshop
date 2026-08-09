package jobs

import (
	"context"
	"errors"
	"os"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"shop/internal/db"
)

func TestSchedulerRunsJobs(t *testing.T) {
	s := NewScheduler()
	var n atomic.Int32
	s.Add("test", 20*time.Millisecond, false, func() error { n.Add(1); return nil })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Start(ctx)
	for i := 0; i < 200 && n.Load() < 2; i++ {
		time.Sleep(10 * time.Millisecond)
	}
	if n.Load() < 2 {
		t.Fatalf("job ran %d times, want >= 2", n.Load())
	}
}

func TestSchedulerRunOnStart(t *testing.T) {
	s := NewScheduler()
	var n atomic.Int32
	s.Add("startup", time.Hour, true, func() error { n.Add(1); return nil })
	s.Add("periodic", time.Hour, false, func() error { n.Add(1); return nil })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Start(ctx)
	for i := 0; i < 200 && n.Load() < 1; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if n.Load() != 1 {
		t.Fatalf("startup run count = %d, want 1 (only RunOnStart job)", n.Load())
	}
}

func TestSchedulerInvalidIntervalSkipped(t *testing.T) {
	s := NewScheduler()
	var n atomic.Int32
	s.Add("bad", 0, true, func() error { n.Add(1); return nil })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Start(ctx)
	time.Sleep(20 * time.Millisecond)
	if n.Load() != 0 {
		t.Fatalf("job with invalid interval ran %d times", n.Load())
	}
}

// TestSchedulerRecordsRuns 验证任务执行记录：成功/失败/panic 均被记录。
func TestSchedulerRecordsRuns(t *testing.T) {
	s := NewScheduler()
	var mu sync.Mutex
	runs := map[string]error{}
	s.SetRecorder(func(name string, _, _ int64, err error) {
		mu.Lock()
		defer mu.Unlock()
		runs[name] = err
	})
	s.Add("ok-job", time.Hour, true, func() error { return nil })
	s.Add("err-job", time.Hour, true, func() error { return errors.New("boom") })
	s.Add("panic-job", time.Hour, true, func() error { panic("boom-panic") })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Start(ctx)
	for i := 0; i < 200 && len(runs) < 3; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	mu.Lock()
	defer mu.Unlock()
	if len(runs) != 3 {
		t.Fatalf("recorded %d runs, want 3", len(runs))
	}
	if runs["ok-job"] != nil {
		t.Fatalf("ok-job err = %v, want nil", runs["ok-job"])
	}
	if runs["err-job"] == nil {
		t.Fatal("err-job should record error")
	}
	if runs["panic-job"] == nil {
		t.Fatal("panic-job should record error")
	}
}

func TestBackupJob(t *testing.T) {
	dir := t.TempDir()
	path := dir + "/shop.db"
	d, err := db.Open(path)
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	d.Close()
	run := BackupJob(path, 1)
	run()
	backups := dir + "/backups"
	entries, err := os.ReadDir(backups)
	if err != nil {
		t.Fatalf("backups dir: %v", err)
	}
	if len(entries) != 1 {
		t.Fatalf("backups = %d, want 1", len(entries))
	}
	run()
	entries, _ = os.ReadDir(backups)
	if len(entries) != 1 {
		t.Fatalf("after prune backups = %d, want 1 (keep=1)", len(entries))
	}
}
