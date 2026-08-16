package hashpay

import (
	"bytes"
	"crypto"
	"crypto/rand"
	"crypto/rsa"
	"crypto/sha256"
	"crypto/x509"
	"encoding/base64"
	"encoding/pem"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"
)

// signedRequest 构造带 RSA 签名的请求（签名原文：method\npath\ntimestamp\nbody）。
func (c *HashPay) signedRequest(method, path string, body []byte) (*http.Request, error) {
	ts := strconv.FormatInt(time.Now().Unix(), 10)
	payload := strings.Join([]string{method, path, ts, string(body)}, "\n")
	sig, err := rsaSignSHA256(c.PrivateKey, []byte(payload))
	if err != nil {
		return nil, fmt.Errorf("hashpay sign request: %w", err)
	}
	req, err := http.NewRequest(method, c.BaseURL+path, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("X-Merchant-Id", c.MerchantID)
	req.Header.Set("X-Timestamp", ts)
	req.Header.Set("X-Signature", base64.StdEncoding.EncodeToString(sig))
	return req, nil
}

// rsaSignSHA256 使用 RSA 私钥做 RSASSA-PKCS1-v1_5 SHA-256 签名。
func rsaSignSHA256(privateKeyPEM string, message []byte) ([]byte, error) {
	key, err := parsePrivateKeyPEM(privateKeyPEM)
	if err != nil {
		return nil, err
	}
	sum := sha256.Sum256(message)
	return rsa.SignPKCS1v15(rand.Reader, key, crypto.SHA256, sum[:])
}

// parsePrivateKeyPEM 解析 PKCS#8 或 PKCS#1 格式的 RSA 私钥。
func parsePrivateKeyPEM(raw string) (*rsa.PrivateKey, error) {
	block, _ := pem.Decode([]byte(raw))
	if block == nil {
		return nil, errors.New("invalid RSA private key PEM")
	}
	if k, err := x509.ParsePKCS8PrivateKey(block.Bytes); err == nil {
		if rk, ok := k.(*rsa.PrivateKey); ok {
			return rk, nil
		}
		return nil, errors.New("private key is not RSA")
	}
	if k, err := x509.ParsePKCS1PrivateKey(block.Bytes); err == nil {
		return k, nil
	}
	return nil, errors.New("invalid RSA private key (expected PKCS#8 or PKCS#1 PEM)")
}

// base64Decode 解码 Base64（兼容 HashPay 可能带换行的输出）。
func base64Decode(s string) ([]byte, error) {
	cleaned := strings.Map(func(r rune) rune {
		switch r {
		case '\n', '\r', ' ', '\t':
			return -1
		}
		return r
	}, s)
	return base64.StdEncoding.DecodeString(cleaned)
}
