package jobs

import (
	"context"
	"sync/atomic"
	"testing"
	"time"
)

func TestBusDeliversJobs(t *testing.T) {
	b := NewBus(16)
	var got atomic.Int32
	b.Start(context.Background(), 2, func(Job) { got.Add(1) })
	for i := 0; i < 10; i++ {
		b.Publish(Job{Kind: KindMail})
	}
	for i := 0; i < 200 && got.Load() < 10; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if got.Load() != 10 {
		t.Fatalf("delivered=%d, want 10", got.Load())
	}
}

// TestBusWorkerPanicRecovered 验证单个任务 panic 不拖垮进程，后续任务继续投递。
func TestBusWorkerPanicRecovered(t *testing.T) {
	b := NewBus(16)
	var attempts, ok atomic.Int32
	b.Start(context.Background(), 1, func(Job) {
		if attempts.Add(1) == 1 {
			panic("boom")
		}
		ok.Add(1)
	})
	b.Publish(Job{Kind: KindMail})
	b.Publish(Job{Kind: KindMail})
	for i := 0; i < 200 && ok.Load() < 1; i++ {
		time.Sleep(5 * time.Millisecond)
	}
	if ok.Load() != 1 {
		t.Fatalf("post-panic delivery failed: ok=%d", ok.Load())
	}
}
