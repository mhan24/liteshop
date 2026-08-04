package security

import (
	"encoding/base32"
	"strings"
	"testing"
	"time"
)

// TestTotpRFC6238 用 RFC 6238 标准测试向量验证。
func TestTotpRFC6238(t *testing.T) {
	// RFC 6238 附录 B: SHA1, 8 位
	secret := base32.StdEncoding.EncodeToString([]byte("12345678901234567890"))
	secret = strings.TrimRight(secret, "=")
	// T=59 -> RFC 8位=94287082, 本项目6位=取后6位 287082
	got, err := TotpCode(secret, time.Unix(59, 0))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got != "287082" {
		t.Fatalf("T=59 got %s, want 287082", got)
	}
	// T=1111111109 -> RFC 8位=07081804, 6位后=081804
	got2, err := TotpCode(secret, time.Unix(1111111109, 0))
	if err != nil {
		t.Fatalf("err: %v", err)
	}
	if got2 != "081804" {
		t.Fatalf("T=1111111109 got %s, want 081804", got2)
	}
}

func TestVerifyTotp(t *testing.T) {
	secret, err := GenerateTotpSecret()
	if err != nil {
		t.Fatalf("gen: %v", err)
	}
	now := time.Now()
	code, err := TotpCode(secret, now)
	if err != nil {
		t.Fatalf("code: %v", err)
	}
	if !VerifyTotp(secret, code, now) {
		t.Fatalf("correct code rejected")
	}
	if VerifyTotp(secret, "000000", now) {
		t.Fatalf("wrong code accepted")
	}
	// 时钟偏差 1 步内应通过
	prev, _ := TotpCode(secret, now.Add(-TotpPeriod*time.Second))
	if !VerifyTotp(secret, prev, now) {
		t.Fatalf("previous-step code rejected (should allow skew)")
	}
}

func TestGenerateSecretUnique(t *testing.T) {
	a, _ := GenerateTotpSecret()
	b, _ := GenerateTotpSecret()
	if a == b {
		t.Fatalf("secrets should differ")
	}
}

func TestOtpauthURL(t *testing.T) {
	url := OtpauthURL("SECRET", "admin@shop.com", "LiteShop")
	if !strings.Contains(url, "otpauth://totp/") || !strings.Contains(url, "secret=SECRET") {
		t.Fatalf("bad otpauth url: %s", url)
	}
}
