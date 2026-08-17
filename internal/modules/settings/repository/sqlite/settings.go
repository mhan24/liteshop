package sqlite

import (
	"database/sql"
	"errors"
	"sort"
	"strings"

	"shop/internal/platform/security"
	"shop/internal/shared/clock"
	"shop/internal/shared/idgen"
)

// SecretSettingKeys 敏感配置键（存 secrets 表，AES-GCM 加密）。
var SecretSettingKeys = []string{
	"bepusdt_api_token",
	"hashpay_private_key",
	"smtp_password",
	"telegram_bot_token",
	"webhook_secret",
	"turnstile_secret",
	"maintenance_password",
}

// GetSetting 读取系统配置；无记录返回空串。
func GetSetting(d *sql.DB, key string) (string, error) {
	var value string
	err := d.QueryRow(`SELECT value FROM settings WHERE key = ?`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", nil
	}
	return value, err
}

// SetSetting 写入（或更新）系统配置。
func SetSetting(d *sql.DB, key, value string) error {
	_, err := d.Exec(`INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, value, clock.Now())
	return err
}

// AllSettings 返回全部系统配置。
func AllSettings(d *sql.DB) (map[string]string, error) {
	rows, err := d.Query(`SELECT key, value FROM settings ORDER BY key`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		out[k] = v
	}
	return out, rows.Err()
}

// SettingsVersion 返回当前配置版本（settings_version 表最大版本，0=未记录）。
func SettingsVersion(d *sql.DB) int {
	var v int
	_ = d.QueryRow(`SELECT COALESCE(MAX(version), 0) FROM settings_version`).Scan(&v)
	return v
}

// EnsureSessionSecret 返回会话主密钥（兼容旧调用方）。
// 新启动路径应使用 EnsureSessionSecretWithError，确保密钥成功持久化。
func EnsureSessionSecret(d *sql.DB) string {
	secret, _ := EnsureSessionSecretWithError(d)
	return secret
}

// EnsureSessionSecretWithError 返回并持久化会话主密钥。
// 密钥无法读取或写入时返回错误，避免服务使用重启后失效的临时密钥。
func EnsureSessionSecretWithError(d *sql.DB) (string, error) {
	if v, err := GetSetting(d, "session_secret"); err == nil && strings.TrimSpace(v) != "" {
		return strings.TrimSpace(v), nil
	}
	secret := idgen.RandomToken(32)
	if err := SetSetting(d, "session_secret", secret); err != nil {
		return "", err
	}
	return secret, nil
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
	return UpsertSecretRaw(d, key, enc)
}

// ApplySetupTx 在首次初始化事务内批量写入普通配置和加密密钥。
func ApplySetupTx(tx *sql.Tx, settings, secrets map[string]string, c *security.Cipher) error {
	settingKeys := make([]string, 0, len(settings))
	for key := range settings {
		settingKeys = append(settingKeys, key)
	}
	sort.Strings(settingKeys)
	for _, key := range settingKeys {
		if _, err := tx.Exec(`INSERT INTO settings(key, value, updated_at) VALUES(?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, settings[key], clock.Now()); err != nil {
			return err
		}
	}
	secretKeys := make([]string, 0, len(secrets))
	for key := range secrets {
		secretKeys = append(secretKeys, key)
	}
	sort.Strings(secretKeys)
	for _, key := range secretKeys {
		if c == nil {
			return errors.New("cipher not initialized")
		}
		enc, err := c.Encrypt(secrets[key])
		if err != nil {
			return err
		}
		if _, err := tx.Exec(`INSERT INTO secrets(key, value, updated_at) VALUES(?, ?, ?)
			ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, key, enc, clock.Now()); err != nil {
			return err
		}
	}
	return nil
}

// UpsertSecretRaw 直接写入已加密值（迁移/内部使用）。
func UpsertSecretRaw(d *sql.DB, key, encrypted string) error {
	_, err := d.Exec(`INSERT INTO secrets(key, value, updated_at) VALUES(?, ?, ?)
		ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
		key, encrypted, clock.Now())
	return err
}
