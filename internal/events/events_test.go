package events

import "testing"

func TestEncodeDecodeRoundTrip(t *testing.T) {
	orig := OrderDeliveredEvent{}
	raw, err := Encode(orig)
	if err != nil {
		t.Fatalf("encode: %v", err)
	}
	dec, err := Decode(raw)
	if err != nil {
		t.Fatalf("decode: %v", err)
	}
	if dec.EventName() != "order.delivered" {
		t.Fatalf("event name = %s", dec.EventName())
	}
}

func TestDecodeLegacyWithoutVersion(t *testing.T) {
	// 老事件没有 version 字段，按 v1 处理。
	dec, err := Decode(`{"type":"order.paid","data":{"OrderID":7}}`)
	if err != nil {
		t.Fatalf("decode legacy: %v", err)
	}
	if dec.EventName() != "order.paid" {
		t.Fatalf("event name = %s", dec.EventName())
	}
}

func TestDecodeRejectsFutureVersion(t *testing.T) {
	if _, err := Decode(`{"type":"order.paid","version":99,"data":{}}`); err == nil {
		t.Fatal("future version should be rejected")
	}
}

func TestDecodeRejectsUnknownType(t *testing.T) {
	if _, err := Decode(`{"type":"unknown.event","version":1,"data":{}}`); err == nil {
		t.Fatal("unknown event type should be rejected")
	}
}
