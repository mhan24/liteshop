package security

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"hash"
	"strconv"
	"unicode"
)

// ValidatePasswordStrength 校验密码强度：至少 8 位且同时包含字母和数字。
func ValidatePasswordStrength(pw string) error {
	if len(pw) < 8 {
		return errors.New("密码至少 8 位")
	}
	hasLetter, hasDigit := false, false
	for _, r := range pw {
		if unicode.IsLetter(r) {
			hasLetter = true
		}
		if unicode.IsDigit(r) {
			hasDigit = true
		}
	}
	if !hasLetter || !hasDigit {
		return errors.New("密码需同时包含字母和数字")
	}
	return nil
}

func pbkdf2(password, salt []byte, iter, keyLen int, h func() hash.Hash) []byte {
	prf := func(key, msg []byte) []byte {
		hm := hmacLike(key, msg, h)
		return hm
	}
	hLen := h().Size()
	numBlocks := (keyLen + hLen - 1) / hLen
	var dk []byte
	for block := 1; block <= numBlocks; block++ {
		blk := make([]byte, 4)
		blk[0] = byte(block >> 24)
		blk[1] = byte(block >> 16)
		blk[2] = byte(block >> 8)
		blk[3] = byte(block)
		u := prf(password, append(append([]byte{}, salt...), blk...))
		t := append([]byte{}, u...)
		for i := 1; i < iter; i++ {
			u = prf(password, u)
			for j := range t {
				t[j] ^= u[j]
			}
		}
		dk = append(dk, t...)
	}
	return dk[:keyLen]
}

func hmacLike(key, msg []byte, h func() hash.Hash) []byte {
	const blockSize = 64
	if len(key) > blockSize {
		hh := h()
		hh.Write(key)
		key = hh.Sum(nil)
	}
	pad := make([]byte, blockSize)
	copy(pad, key)
	inner := make([]byte, blockSize)
	outer := make([]byte, blockSize)
	for i := range pad {
		inner[i] = pad[i] ^ 0x36
		outer[i] = pad[i] ^ 0x5c
	}
	ih := h()
	ih.Write(inner)
	ih.Write(msg)
	innerSum := ih.Sum(nil)
	oh := h()
	oh.Write(outer)
	oh.Write(innerSum)
	return oh.Sum(nil)
}

// HashPassword 返回 PBKDF2 哈希（格式：pbkdf2$iter$salt$hash）。
func HashPassword(password string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	dk := pbkdf2([]byte(password), salt, 100000, 32, sha256.New)
	return "pbkdf2$100000$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(dk)
}

// CheckPassword 校验密码哈希（恒定时间比较）。
func CheckPassword(password, encoded string) bool {
	parts := split4(encoded)
	if len(parts) != 4 || parts[0] != "pbkdf2" {
		return false
	}
	iters, err := strconv.Atoi(parts[1])
	if err != nil || iters <= 0 {
		return false
	}
	salt, err := base64.RawStdEncoding.DecodeString(parts[2])
	if err != nil {
		return false
	}
	want, err := base64.RawStdEncoding.DecodeString(parts[3])
	if err != nil || len(want) == 0 {
		return false
	}
	got := pbkdf2([]byte(password), salt, iters, len(want), sha256.New)
	return subtle.ConstantTimeCompare(got, want) == 1
}

func split4(s string) []string {
	parts := make([]string, 0, 4)
	start := 0
	for i := 0; i < len(s); i++ {
		if s[i] == '$' {
			parts = append(parts, s[start:i])
			start = i + 1
		}
	}
	parts = append(parts, s[start:])
	return parts
}
