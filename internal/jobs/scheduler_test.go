package jobs

import (
	"context"
	"os"
	"sync/atomic"
	"testing"
	"time"

	"shop/internal/db"
)

func TestSchedulerRunsJobs(t *testing.T) {
	s := NewScheduler()
	var n atomic.Int32
	s.Add("test", 20*time.Millisecond, false, func() { n.Add(1) })
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
	s.Add("startup", time.Hour, true, func() { n.Add(1) })
	s.Add("periodic", time.Hour, false, func() { n.Add(1) })
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
	s.Add("bad", 0, true, func() { n.Add(1) })
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	s.Start(ctx)
	time.Sleep(20 * time.Millisecond)
	if n.Load() != 0 {
		t.Fatalf("job with invalid interval ran %d times", n.Load())
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
