package service

import (
	"time"

	"shop/internal/db/repository"
	"shop/internal/models"
	"shop/internal/security"
)

// ---- 管理员 ----

// AdminRow 管理员列表行。
type AdminRow struct {
	ID        int64
	Username  string
	Role      string
	CreatedAt int64
}

func (s *AdminService) AdminUsername(id int64) (string, error) {
	return repository.AdminUsername(s.db, id)
}

func (s *AdminService) AdminRole(id int64) (string, error) {
	return repository.AdminRole(s.db, id)
}

func (s *AdminService) AdminPasswordHash(id int64) (string, error) {
	return repository.AdminPasswordHash(s.db, id)
}

func (s *AdminService) AdminTOTP(id int64) (bool, string, error) {
	return repository.AdminTOTP(s.db, id)
}

func (s *AdminService) UpdateAccount(id int64, username, hash string) error {
	return repository.UpdateAdminAccount(s.db, id, username, hash)
}

func (s *AdminService) SetTOTPSecret(id int64, encryptedSecret string) error {
	return repository.SetAdminTOTPSecret(s.db, id, encryptedSecret)
}

func (s *AdminService) SetTOTPEnabled(id int64, enabled bool) error {
	return repository.SetAdminTOTPEnabled(s.db, id, enabled)
}

// ListAdmins 返回全部管理员。
func (s *AdminService) ListAdmins() ([]AdminRow, error) {
	rows, err := repository.ListAdmins(s.db)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AdminRow{}
	for rows.Next() {
		var row AdminRow
		if err := rows.Scan(&row.ID, &row.Username, &row.Role, &row.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// CreateAdmin 创建管理员（密码已哈希）。用户名重复返回 ErrAdminExists。
func (s *AdminService) CreateAdmin(username, password, role string) error {
	if err := repository.CreateAdmin(s.db, username, models.HashPassword(password), role); err != nil {
		return ErrAdminExists
	}
	return nil
}

// SetRole 更新角色；最后一个 admin 不可降级。
func (s *AdminService) SetRole(id int64, role string) error {
	err := repository.SetAdminRoleGuarded(s.db, id, role)
	switch {
	case err == repository.ErrAdminNotFound:
		return ErrAdminNotFound
	case err == repository.ErrLastAdmin:
		return ErrLastAdmin
	}
	return err
}

// DeleteAdmin 删除管理员并吊销其全部会话；最后一个 admin 不可删除。
func (s *AdminService) DeleteAdmin(id int64) error {
	role, err := repository.AdminRole(s.db, id)
	if err != nil {
		return ErrAdminNotFound
	}
	if role == models.RoleAdmin {
		admins, err := repository.AdminCountByRole(s.db, models.RoleAdmin)
		if err != nil {
			return err
		}
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	if err := repository.DeleteAdmin(s.db, id); err != nil {
		return err
	}
	return repository.DeleteSessionsByAdmin(s.db, id)
}

// ---- TOTP 账户操作 ----

// TotpStatus 返回 TOTP 状态；未启用且已有密钥时返回明文（用于扫码）。
func (s *AdminService) TotpStatus(id int64) (enabled bool, plainSecret string, err error) {
	enabled, secret, err := repository.AdminTOTP(s.db, id)
	if err != nil {
		return false, "", err
	}
	if !enabled && secret != "" {
		if plain, err := s.cipher.Decrypt(secret); err == nil {
			plainSecret = plain
		}
	}
	return enabled, plainSecret, nil
}

// GenerateTotp 生成新 TOTP 密钥并加密存储（未启用时）。返回明文密钥。
func (s *AdminService) GenerateTotp(id int64) (string, error) {
	enabled, _, err := repository.AdminTOTP(s.db, id)
	if err != nil {
		return "", err
	}
	if enabled {
		return "", ErrTotpAlreadyEnabled
	}
	secret, err := security.GenerateTotpSecret()
	if err != nil {
		return "", err
	}
	encrypted, err := s.cipher.Encrypt(secret)
	if err != nil {
		return "", err
	}
	if err := repository.SetAdminTOTPSecret(s.db, id, encrypted); err != nil {
		return "", err
	}
	return secret, nil
}

// EnableTotp 校验 OTP 后启用 TOTP。
func (s *AdminService) EnableTotp(id int64, plainSecret, otp string) error {
	if !security.VerifyTotp(plainSecret, otp, time.Now()) {
		return ErrInvalidOtp
	}
	encrypted, err := s.cipher.Encrypt(plainSecret)
	if err != nil {
		return err
	}
	if err := repository.SetAdminTOTPSecret(s.db, id, encrypted); err != nil {
		return err
	}
	return repository.SetAdminTOTPEnabled(s.db, id, true)
}

// DisableTotp 校验 OTP 后关闭 TOTP。
func (s *AdminService) DisableTotp(id int64, otp string) error {
	_, secret, err := repository.AdminTOTP(s.db, id)
	if err != nil {
		return err
	}
	decrypted, err := s.cipher.Decrypt(secret)
	if err != nil {
		return err
	}
	if !security.VerifyTotp(decrypted, otp, time.Now()) {
		return ErrInvalidOtp
	}
	return repository.SetAdminTOTPEnabled(s.db, id, false)
}
