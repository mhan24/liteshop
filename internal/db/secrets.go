package db

import (
	"database/sql"
	"errors"
	"strings"

	"shop/internal/models"
	"shop/internal/security"
)

// SecretSettingKeys 敏感配置键（存 secrets 表，AES-GCM 加密）。
var SecretSettingKeys = []string{
	"bepusdt_api_token",
	"smtp_password",
	"telegram_bot_token",
	"webhook_secret",
	"turnstile_secret",
	"maintenance_password",
}

// EnsureSessionSecret 返回会话主密钥（缺失时生成并写入 settings）。
// 该密钥用于派生 secrets/TOTP 的 AES 密钥，明文保存在 settings 表。
func EnsureSessionSecret(d *sql.DB) string {
	if v, err := GetSetting(d, "session_secret"); err == nil && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v)
	}
	secret := models.RandomToken(32)
	_ = SetSetting(d, "session_secret", secret)
	return secret
}

// GetSecret 读取并解密敏感配置；无记录返回空串。
func GetSecret(d *sql.DB, key string, c *security.Cipher) (string, error) {
	var v string
	err := d.QueryRow(`SELECT value FROM secrets WHERE key = ?`, key).Scan(&v)
	if err == sql.ErrNoRows {
		return "", nil
	}
	if err != nil {
		return "", err
	}
	if c == nil {
		return "", errors.New("cipher not initialized")
	}
	return c.Decrypt(v)
}

// SetSecret 加密并写入敏感配置。
func SetSecret(d *sql.DB, key, value string, c *security.Cipher) error {
	if c == nil {
		return errors.New("cipher not initialized")
	}
	enc, err := c.Encrypt(value)
	if err != nil {
		return err
	}
	return upsertSecret(d, key, enc)
}

// upsertSecret 直接写入已加密值（迁移/内部使用）。
func upsertSecret(d *sql.DB, key, encrypted string) error {
	_, err := d.Exec(`INSERT INTO secrets(key, value, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, encrypted, models.Now())
	return err
}

// ensureSecretsTable 建 secrets 表，并把存量 settings 中的敏感配置迁移为 AES 加密存储。
func ensureSecretsTable(d *sql.DB) error {
	cipher := security.NewCipher(EnsureSessionSecret(d))
	if cipher == nil {
		return errors.New("cipher init failed")
	}
	for _, key := range SecretSettingKeys {
		v, err := GetSetting(d, key)
		if err != nil {
			return err
		}
		if strings.TrimSpace(v) == "" {
			continue
		}
		if cipher.IsEncrypted(v) {
			if err := upsertSecret(d, key, v); err != nil {
				return err
			}
		} else {
			enc, err := cipher.Encrypt(v)
			if err != nil {
				return err
			}
			if err := upsertSecret(d, key, enc); err != nil {
				return err
			}
		}
		if _, err := d.Exec(`DELETE FROM settings WHERE key = ?`, key); err != nil {
			return err
		}
	}
	return nil
}
