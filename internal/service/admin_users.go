package service

import (
	"time"

	"shop/internal/models"
	"shop/internal/security"
)

// ---- 管理员 ----

// AdminRow 管理员列表行（收敛到 models.AdminRow）。
type AdminRow = models.AdminRow

func (s *AdminService) AdminUsername(id int64) (string, error) {
	return s.store.AdminUsername(id)
}

func (s *AdminService) AdminRole(id int64) (string, error) {
	return s.store.AdminRole(id)
}

func (s *AdminService) AdminPasswordHash(id int64) (string, error) {
	return s.store.AdminPasswordHash(id)
}

func (s *AdminService) AdminTOTP(id int64) (bool, string, error) {
	return s.store.AdminTOTP(id)
}

func (s *AdminService) UpdateAccount(id int64, username, hash string) error {
	return s.store.UpdateAdminAccount(id, username, hash)
}

func (s *AdminService) SetTOTPSecret(id int64, encryptedSecret string) error {
	return s.store.SetAdminTOTPSecret(id, encryptedSecret)
}

func (s *AdminService) SetTOTPEnabled(id int64, enabled bool) error {
	return s.store.SetAdminTOTPEnabled(id, enabled)
}

// ListAdmins 返回全部管理员。
func (s *AdminService) ListAdmins() ([]AdminRow, error) {
	return s.store.ListAdmins()
}

// CreateAdmin 创建管理员（密码已哈希）。用户名重复返回 ErrAdminExists。
func (s *AdminService) CreateAdmin(username, password, role string) error {
	if err := s.store.CreateAdmin(username, models.HashPassword(password), role); err != nil {
		return ErrAdminExists
	}
	return nil
}

// SetRole 更新角色；最后一个 admin 不可降级。
func (s *AdminService) SetRole(id int64, role string) error {
	err := s.store.SetAdminRoleGuarded(id, role)
	switch {
	case err == models.ErrAdminNotFound:
		return ErrAdminNotFound
	case err == models.ErrLastAdmin:
		return ErrLastAdmin
	}
	return err
}

// DeleteAdmin 删除管理员并吊销其全部会话；最后一个 admin 不可删除。
func (s *AdminService) DeleteAdmin(id int64) error {
	role, err := s.store.AdminRole(id)
	if err != nil {
		return ErrAdminNotFound
	}
	if role == models.RoleAdmin {
		admins, err := s.store.AdminCountByRole(models.RoleAdmin)
		if err != nil {
			return err
		}
		if admins <= 1 {
			return ErrLastAdmin
		}
	}
	if err := s.store.DeleteAdmin(id); err != nil {
		return err
	}
	return s.store.DeleteSessionsByAdmin(id)
}

// ---- TOTP 账户操作 ----

// TotpStatus 返回 TOTP 状态；未启用且已有密钥时返回明文（用于扫码）。
func (s *AdminService) TotpStatus(id int64) (enabled bool, plainSecret string, err error) {
	enabled, secret, err := s.store.AdminTOTP(id)
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
	enabled, _, err := s.store.AdminTOTP(id)
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
	if err := s.store.SetAdminTOTPSecret(id, encrypted); err != nil {
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
	if err := s.store.SetAdminTOTPSecret(id, encrypted); err != nil {
		return err
	}
	return s.store.SetAdminTOTPEnabled(id, true)
}

// DisableTotp 校验 OTP 后关闭 TOTP。
func (s *AdminService) DisableTotp(id int64, otp string) error {
	_, secret, err := s.store.AdminTOTP(id)
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
	return s.store.SetAdminTOTPEnabled(id, false)
}
