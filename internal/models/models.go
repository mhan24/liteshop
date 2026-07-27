package models

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"fmt"
	"hash"
	"strconv"
	"time"
)

type Product struct {
	ID          int64
	Name        string
	Description string
	PriceCents  int64
	Status      string
	Category    string
	SortOrder   int
	IsPinned    bool
	CreatedAt   int64
	UpdatedAt   int64
}

type Card struct {
	ID        int64
	ProductID int64
	OrderID   int64
	Content   string
	Status    string
	CreatedAt int64
	UpdatedAt int64
	SoldAt    int64
}

type Order struct {
	ID                 int64
	OrderNo            string
	ProductID          int64
	ProductName        string
	Qty                int
	AmountCents        int64
	Fiat               string
	TradeType          string
	BuyerContact       string
	Status             string
	TradeID            string
	PaymentURL         string
	BlockTransactionID string
	CreatedAt          int64
	UpdatedAt          int64
	PaidAt             int64
}

func Now() int64 { return time.Now().Unix() }

var BeijingLocation = time.FixedZone("Asia/Shanghai", 8*3600)

func FormatBeijing(ts int64) string {
	if ts <= 0 {
		return "-"
	}
	return time.Unix(ts, 0).In(BeijingLocation).Format("2006-01-02 15:04:05")
}

func NewOrderNo() string {
	var b [6]byte
	_, _ = rand.Read(b[:])
	return "S" + time.Now().Format("20060102150405") + "-" + base64.RawURLEncoding.EncodeToString(b[:])
}

func RandomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}

func CentsFromYuan(s string) (int64, error) {
	f, err := strconv.ParseFloat(s, 64)
	if err != nil {
		return 0, err
	}
	if f < 0 {
		return 0, fmt.Errorf("price must be positive")
	}
	return int64(f*100 + 0.5), nil
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

func HashPassword(password string) string {
	salt := make([]byte, 16)
	_, _ = rand.Read(salt)
	dk := pbkdf2([]byte(password), salt, 100000, 32, sha256.New)
	return "pbkdf2$100000$" + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(dk)
}

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
