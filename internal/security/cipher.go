package security

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

// cipherPrefix 标记 AES-GCM 加密值；无前缀的旧值视为明文（兼容迁移）。
const cipherPrefix = "aesgcm:v1:"

// Cipher 用 AES-GCM 加密小段敏感数据（如 TOTP secret）。
type Cipher struct {
	gcm cipher.AEAD
}

// NewCipher 从 session_secret 派生 AES-256 密钥。secret 为空时拒绝初始化。
func NewCipher(sessionSecret string) *Cipher {
	if strings.TrimSpace(sessionSecret) == "" {
		return nil
	}
	key := sha256.Sum256([]byte(sessionSecret))
	block, _ := aes.NewCipher(key[:])
	gcm, _ := cipher.NewGCM(block)
	return &Cipher{gcm: gcm}
}

// Encrypt 加密并加版本前缀（aesgcm:v1:<base64 nonce||ciphertext>）。
func (c *Cipher) Encrypt(plain string) (string, error) {
	if c == nil || c.gcm == nil {
		return "", errors.New("cipher not initialized")
	}
	nonce := make([]byte, c.gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}
	out := c.gcm.Seal(nonce, nonce, []byte(plain), nil)
	return cipherPrefix + base64.StdEncoding.EncodeToString(out), nil
}

// Decrypt 解密；无前缀的值视为旧明文原样返回，由调用方在验证成功后升级加密。
func (c *Cipher) Decrypt(value string) (string, error) {
	if strings.HasPrefix(value, cipherPrefix) {
		if c == nil || c.gcm == nil {
			return "", errors.New("cipher not initialized")
		}
		encoded := strings.TrimPrefix(value, cipherPrefix)
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
	// 旧明文：原样返回（兼容迁移）
	return value, nil
}

// IsEncrypted 判断值是否已加密（带版本前缀）。
func (c *Cipher) IsEncrypted(value string) bool {
	return strings.HasPrefix(value, cipherPrefix)
}
