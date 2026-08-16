// Package security 提供 TOTP 双因素认证（RFC 6238，纯 Go 无外部依赖）。
package security

import (
	"crypto/hmac"
	"crypto/rand"
	"crypto/sha1"
	"encoding/base32"
	"encoding/binary"
	"fmt"
	"strings"
	"time"
)

const (
	// TotpPeriod 时间步长（秒）。
	TotpPeriod = 30
	// TotpDigits 验证码位数。
	TotpDigits = 6
)

// GenerateTotpSecret 生成 32 字节 base32 编码的 TOTP 密钥。
func GenerateTotpSecret() (string, error) {
	buf := make([]byte, 20)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	return strings.TrimRight(base32.StdEncoding.EncodeToString(buf), "="), nil
}

// TotpCode 计算当前步长的验证码。
func TotpCode(secret string, at time.Time) (string, error) {
	key, err := decodeSecret(secret)
	if err != nil {
		return "", err
	}
	counter := uint64(at.Unix() / TotpPeriod)
	return totpFromKey(key, counter), nil
}

// VerifyTotp 校验用户输入的验证码（允许前后各一步时钟偏差）。
func VerifyTotp(secret, code string, at time.Time) bool {
	code = strings.TrimSpace(code)
	if code == "" {
		return false
	}
	key, err := decodeSecret(secret)
	if err != nil {
		return false
	}
	counter := uint64(at.Unix() / TotpPeriod)
	for _, delta := range []int64{0, -1, 1} {
		want := totpFromKey(key, uint64(int64(counter)+delta))
		if hmac.Equal([]byte(want), []byte(code)) {
			return true
		}
	}
	return false
}

// OtpauthURL 生成用于扫码的 otpauth URI。
func OtpauthURL(secret, account, issuer string) string {
	label := strings.ReplaceAll(account, " ", "%20")
	iss := strings.ReplaceAll(issuer, " ", "%20")
	return fmt.Sprintf("otpauth://totp/%s?secret=%s&issuer=%s&digits=%d&period=%d", label, secret, iss, TotpDigits, TotpPeriod)
}

func decodeSecret(secret string) ([]byte, error) {
	s := strings.ToUpper(strings.TrimSpace(secret))
	s = strings.ReplaceAll(s, " ", "")
	padded := s
	if rem := len(s) % 8; rem != 0 {
		padded += strings.Repeat("=", 8-rem)
	}
	key, err := base32.StdEncoding.DecodeString(padded)
	if err != nil {
		return nil, err
	}
	if len(key) == 0 {
		return nil, fmt.Errorf("empty secret")
	}
	return key, nil
}

func totpFromKey(key []byte, counter uint64) string {
	var msg [8]byte
	binary.BigEndian.PutUint64(msg[:], counter)
	mac := hmac.New(sha1.New, key)
	_, _ = mac.Write(msg[:])
	sum := mac.Sum(nil)
	offset := sum[len(sum)-1] & 0x0f
	code := (uint32(sum[offset])&0x7f)<<24 |
		uint32(sum[offset+1])<<16 |
		uint32(sum[offset+2])<<8 |
		uint32(sum[offset+3])
	mod := uint32(1)
	for i := 0; i < TotpDigits; i++ {
		mod *= 10
	}
	return fmt.Sprintf("%0*d", TotpDigits, code%mod)
}
