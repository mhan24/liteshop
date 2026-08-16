// Package idgen 提供订单号/随机令牌生成。
package idgen

import (
	"crypto/rand"
	"encoding/base64"
	"time"
)

// NewOrderNo 生成订单号：S + 时间 + 随机后缀。
func NewOrderNo() string {
	var b [8]byte
	_, _ = rand.Read(b[:])
	return "S" + time.Now().Format("20060102150405") + "-" + base64.RawURLEncoding.EncodeToString(b[:])
}

// RandomToken 生成 n 字节随机令牌（base64url 编码）。
func RandomToken(n int) string {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return base64.RawURLEncoding.EncodeToString(b)
}
