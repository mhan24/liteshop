package events

import (
	"sync/atomic"
	"testing"
	"time"
)

func TestFanoutIsolatesConsumerPanic(t *testing.T) {
	var hits atomic.Int32
	var panics atomic.Int32
	f := NewFanout(
		Consumer{Name: "boom", Handle: func(Event) { panic("consumer boom") }},
		Consumer{Name: "ok", Handle: func(Event) { hits.Add(1) }},
	)
	f.SetPanicHandler(func(name string, _ any) {
		if name != "boom" {
			t.Fatalf("panic handler got consumer %q, want boom", name)
		}
		panics.Add(1)
	})
	f.Publish(OrderCreatedEvent{})
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) && (hits.Load() == 0 || panics.Load() == 0) {
		time.Sleep(5 * time.Millisecond)
	}
	if hits.Load() != 1 {
		t.Fatalf("healthy consumer hits = %d, want 1 (panic must be isolated)", hits.Load())
	}
	if panics.Load() != 1 {
		t.Fatalf("panic handler calls = %d, want 1", panics.Load())
	}
}
