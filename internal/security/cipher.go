package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
)

// Cipher 用 AES-GCM 加密小段敏感数据（如 TOTP secret）。
type Cipher struct {
	gcm cipher.AEAD
}

// NewCipher 从 session_secret 派生 AES-256 密钥。
func NewCipher(sessionSecret string) *Cipher {
	key := sha256.Sum256([]byte(sessionSecret))
	block, _ := aes.NewCipher(key[:])
	gcm, _ := cipher.NewGCM(block)
	return &Cipher{gcm: gcm}
}

// Encrypt 加密并 base64 编码（nonce||ciphertext）。
func (c *Cipher) Encrypt(plain string) (string, error) {
	if c == nil || c.gcm == nil {
		return "", errors.New("cipher not initialized")
	}
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	out := c.gcm.Seal(nonce, nonce, []byte(plain), nil)
	return base64.StdEncoding.EncodeToString(out), nil
}

// Decrypt 解码并解密（nonce||ciphertext）。
func (c *Cipher) Decrypt(encoded string) (string, error) {
	if c == nil || c.gcm == nil {
		return "", errors.New("cipher not initialized")
	}
	data, err := base64.StdEncoding.DecodeString(encoded)
	if err != nil {
		return "", err
	}
	if len(data) < c.gcm.NonceSize() {
		return "", errors.New("ciphertext too short")
	}
	nonce, ct := data[:c.gcm.NonceSize()], data[c.gcm.NonceSize():]
	plain, err := c.gcm.Open(nil, nonce, ct, nil)
	if err != nil {
		return "", err
	}
	return string(plain), nil
}
