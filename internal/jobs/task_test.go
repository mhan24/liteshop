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
