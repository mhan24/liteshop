package payment

import (
	"strings"
	"testing"
)

func TestSignDeterministic(t *testing.T) {
	params := map[string]string{
		"order_id":   "S123",
		"amount":     "10.50",
		"trade_type": "usdt-trc20",
		"signature":  "ignored",
		"":           "empty-key-should-skip",
	}
	first := Sign(params, "tok123")
	second := Sign(params, "tok123")
	if first != second {
		t.Fatalf("sign not deterministic: %s vs %s", first, second)
	}
	if len(first) != 32 {
		t.Fatalf("md5 hex should be 32 chars, got %d", len(first))
	}
}

func TestSignIgnoresEmptyAndSignature(t *testing.T) {
	a := Sign(map[string]string{"a": "1", "b": ""}, "t")
	b := Sign(map[string]string{"a": "1"}, "t")
	if a != b {
		t.Fatalf("empty value should be ignored: %s vs %s", a, b)
	}
	c := Sign(map[string]string{"a": "1", "signature": "anything"}, "t")
	if c != b {
		t.Fatalf("signature key should be ignored: %s vs %s", c, b)
	}
}

func TestSignTokenAffectsResult(t *testing.T) {
	a := Sign(map[string]string{"a": "1"}, "token-a")
	b := Sign(map[string]string{"a": "1"}, "token-b")
	if a == b {
		t.Fatalf("different tokens should produce different signatures")
	}
}

func TestParseAndVerifyCallbackOK(t *testing.T) {
	token := "secret"
	payload := signedPayload(t, token, map[string]string{"order_id": "S1", "amount": "10", "trade_type": "usdt-trc20", "status": "2"})
	params, err := ParseAndVerifyCallback([]byte(payload), token)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if params["order_id"] != "S1" {
		t.Fatalf("order_id = %q", params["order_id"])
	}
}

func TestParseAndVerifyCallbackNumeric(t *testing.T) {
	token := "secret"
	payload := signedPayload(t, token, map[string]string{"order_id": "S1", "amount": "10", "status": "2", "paid": "true"})
	params, err := ParseAndVerifyCallback([]byte(payload), token)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if params["amount"] != "10" {
		t.Fatalf("amount = %q", params["amount"])
	}
	if params["status"] != "2" {
		t.Fatalf("status = %q", params["status"])
	}
	if params["paid"] != "true" {
		t.Fatalf("paid = %q", params["paid"])
	}
}

func TestParseAndVerifyCallbackBadSignature(t *testing.T) {
	payload := `{"order_id":"S1","amount":"10","signature":"deadbeef"}`
	if _, err := ParseAndVerifyCallback([]byte(payload), "secret"); err == nil {
		t.Fatalf("expected signature error")
	}
}

func TestParseAndVerifyCallbackNilSkipped(t *testing.T) {
	payload := signedPayload(t, "secret", map[string]string{"order_id": "S1", "empty": ""})
	params, err := ParseAndVerifyCallback([]byte(payload), "secret")
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if _, ok := params["empty"]; ok {
		t.Fatalf("nil value should be skipped")
	}
}

// signedPayload 构造包含合法签名的 JSON payload，仅含非空键。
func signedPayload(t *testing.T, token string, values map[string]string) string {
	t.Helper()
	params := make(map[string]string)
	for k, v := range values {
		if v != "" {
			params[k] = v
		}
	}
	sig := Sign(params, token)
	var parts []string
	for k, v := range params {
		parts = append(parts, `"`+k+`":"`+v+`"`)
	}
	parts = append(parts, `"signature":"`+sig+`"`)
	return "{" + strings.Join(parts, ",") + "}"
}

func TestRoundTripSignVerify(t *testing.T) {
	token := "tok-roundtrip"
	payload := signedPayload(t, token, map[string]string{"order_id": "S42", "amount": "19.99", "trade_type": "usdt-erc20"})
	out, err := ParseAndVerifyCallback([]byte(payload), token)
	if err != nil {
		t.Fatalf("round trip failed: %v", err)
	}
	if out["amount"] != "19.99" {
		t.Fatalf("amount = %q", out["amount"])
	}
}
