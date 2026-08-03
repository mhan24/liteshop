package models

import (
	"strings"
	"testing"
)

func TestCentsFromYuan(t *testing.T) {
	cases := []struct {
		in   string
		want int64
		err  bool
	}{
		{"1", 100, false},
		{"10.50", 1050, false},
		{"0.01", 1, false},
		{"100", 10000, false},
		{"-5", 0, true},
		{"abc", 0, true},
		{"", 0, true},
		{"0", 0, false},
	}
	for _, c := range cases {
		got, err := CentsFromYuan(c.in)
		if c.err {
			if err == nil {
				t.Errorf("CentsFromYuan(%q): expected error, got %d", c.in, got)
			}
			continue
		}
		if err != nil {
			t.Errorf("CentsFromYuan(%q): unexpected error %v", c.in, err)
			continue
		}
		if got != c.want {
			t.Errorf("CentsFromYuan(%q) = %d, want %d", c.in, got, c.want)
		}
	}
}

func TestNewOrderNoFormat(t *testing.T) {
	a := NewOrderNo()
	b := NewOrderNo()
	if a == b {
		t.Fatalf("order numbers should differ")
	}
	if !strings.HasPrefix(a, "S") || len(a) < 10 {
		t.Fatalf("bad order number format: %q", a)
	}
}

func TestRandomTokenLength(t *testing.T) {
	for _, n := range []int{8, 16, 32} {
		tok := RandomToken(n)
		if len(tok) < n {
			t.Fatalf("RandomToken(%d) too short: %d", n, len(tok))
		}
	}
}

func TestPasswordHashCheck(t *testing.T) {
	hash := HashPassword("correct horse battery staple")
	if !CheckPassword("correct horse battery staple", hash) {
		t.Fatalf("correct password rejected")
	}
	if CheckPassword("wrong", hash) {
		t.Fatalf("wrong password accepted")
	}
}

func TestPasswordHashNotPlaintext(t *testing.T) {
	hash := HashPassword("secret-password")
	if strings.Contains(hash, "secret-password") {
		t.Fatalf("hash contains plaintext")
	}
	if !strings.HasPrefix(hash, "pbkdf2$") {
		t.Fatalf("unexpected hash format: %s", hash)
	}
}

func TestCheckPasswordBadFormat(t *testing.T) {
	if CheckPassword("x", "") {
		t.Fatalf("empty encoded accepted")
	}
	if CheckPassword("x", "not-a-valid-format") {
		t.Fatalf("malformed encoded accepted")
	}
}

func TestFormatBeijing(t *testing.T) {
	if FormatBeijing(0) != "-" {
		t.Fatalf("FormatBeijing(0) should be -")
	}
	// 2026-01-02 03:04:05 UTC = 2026-01-02 11:04:05 Beijing
	if got := FormatBeijing(1767323045); got != "2026-01-02 11:04:05" {
		t.Fatalf("FormatBeijing = %q", got)
	}
}

func TestSlugify(t *testing.T) {
	cases := map[string]string{
		"优惠码 2026":        "优惠码-2026",
		"Voxi & Best VPN": "voxi-best-vpn",
		"A---B":           "a-b",
		"   ":             "p",
		"Hello World!":    "hello-world",
		"苹果-iPhone15":     "苹果-iphone15",
	}
	for in, want := range cases {
		if got := Slugify(in); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestOrderTransitions(t *testing.T) {
	valid := []struct{ from, to string }{
		{OrderCreated, OrderWaitingPayment},
		{OrderCreated, OrderPaymentFailed},
		{OrderCreated, OrderCancelled},
		{OrderWaitingPayment, OrderPaid},
		{OrderWaitingPayment, OrderExpired},
		{OrderWaitingPayment, OrderCancelled},
		{OrderPaid, OrderProcessing},
		{OrderPaid, OrderDeliveryFailed},
		{OrderPaid, OrderCompleted},
		{OrderProcessing, OrderDelivered},
		{OrderProcessing, OrderDeliveryFailed},
		{OrderDelivered, OrderCompleted},
	}
	for _, c := range valid {
		if !IsValidOrderTransition(c.from, c.to) {
			t.Errorf("transition %s -> %s should be valid", c.from, c.to)
		}
	}
	invalid := []struct{ from, to string }{
		{OrderWaitingPayment, OrderProcessing},
		{OrderPaid, OrderWaitingPayment},
		{OrderExpired, OrderPaid},
		{OrderCompleted, OrderDelivered},
		{OrderCreated, OrderDelivered},
		{"", OrderPaid},
	}
	for _, c := range invalid {
		if IsValidOrderTransition(c.from, c.to) {
			t.Errorf("transition %s -> %s should be invalid", c.from, c.to)
		}
	}
	if !IsOrderFinal(OrderCompleted) || !IsOrderFinal(OrderExpired) || !IsOrderFinal(OrderDeliveryFailed) {
		t.Errorf("final states not recognized")
	}
	if IsOrderFinal(OrderPaid) || IsOrderFinal(OrderWaitingPayment) {
		t.Errorf("non-final states marked final")
	}
}
