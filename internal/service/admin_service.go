package service

import (
	"errors"
	"fmt"
	"sync"
	"time"

	"shop/internal/models"
	"shop/internal/security"
)

var (
	ErrLoginLocked        = errors.New("login locked")
	ErrBadCredentials     = errors.New("invalid credentials")
	ErrInvalidOtp         = errors.New("invalid otp")
	ErrTotpUpgradeFailed  = errors.New("totp secret upgrade failed")
	ErrTotpAlreadyEnabled = errors.New("totp already enabled")
	ErrAdminNotFound      = errors.New("admin not found")
	ErrLastAdmin          = errors.New("cannot demote the last admin")
	ErrAdminExists        = errors.New("admin already exists")
)

type loginGuard struct {
	fails       int
	lockedUntil int64
	lastAttempt int64
}

type totpPending struct {
	adminID int64
	expiry  time.Time
}

// AdminService 管理员认证/会话/RBAC/审计的统一入口（按职责拆分到 admin_*.go 小文件）。
type AdminService struct {
	store         AdminStore
	cipher        *security.Cipher
	onSystemError func(string)

	mu         sync.Mutex
	loginFails map[string]loginGuard
	totp       map[string]totpPending
}

func NewAdminService(store AdminStore, cipher *security.Cipher, onSystemError func(string)) *AdminService {
	return &AdminService{
		store:         store,
		cipher:        cipher,
		onSystemError: onSystemError,
		loginFails:    make(map[string]loginGuard),
		totp:          make(map[string]totpPending),
	}
}

// HasAdmin 是否存在至少一个管理员。
func (s *AdminService) HasAdmin() bool {
	return s.store.HasAdmin()
}

// SeedAdmin 创建初始管理员（已存在返回 (false, nil)）。
func (s *AdminService) SeedAdmin(username, password string) (bool, error) {
	return s.store.SeedAdmin(username, password)
}

// Login 校验用户名/密码；成功返回 adminID 与是否启用 TOTP。
// 错误为 ErrLoginLocked / ErrBadCredentials / 系统错误。
func (s *AdminService) Login(username, password string) (int64, bool, error) {
	if s.LoginLocked(username) {
		return 0, false, ErrLoginLocked
	}
	adminID, hash, totpSecret, totpEnabled, err := s.store.AdminByUsername(username)
	if err == models.ErrAdminNotFound {
		// 恒定时间：对不存在用户也执行一次 PBKDF2，避免用户名枚举时间侧信道。
		_ = models.HashPassword(password)
		return 0, false, ErrBadCredentials
	}
	if err != nil {
		return 0, false, err
	}
	if !models.CheckPassword(password, hash) {
		s.RecordLoginFail(username)
		if s.LoginLocked(username) {
			return 0, false, ErrLoginLocked
		}
		return 0, false, ErrBadCredentials
	}
	s.ClearLoginFails(username)
	_ = totpSecret
	return adminID, totpEnabled, nil
}

// VerifyLoginTotp 校验登录 TOTP（含旧明文升级为加密存储）。
func (s *AdminService) VerifyLoginTotp(adminID int64, code string) error {
	enabled, secret, err := s.store.AdminTOTP(adminID)
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}
	decrypted, err := s.cipher.Decrypt(secret)
	if err != nil {
		return err
	}
	if !security.VerifyTotp(decrypted, code, time.Now()) {
		return ErrInvalidOtp
	}
	// 旧明文升级为加密存储（首次验证成功后回写）；失败须中断，防止迁移失败被掩盖
	if !s.cipher.IsEncrypted(secret) {
		enc, err := s.cipher.Encrypt(decrypted)
		if err != nil {
			return err
		}
		if err := s.store.SetAdminTOTPSecret(adminID, enc); err != nil {
			if s.onSystemError != nil {
				s.onSystemError("TOTP 旧明文升级失败 admin=" + fmt.Sprint(adminID) + ": " + err.Error())
			}
			return ErrTotpUpgradeFailed
		}
	}
	return nil
}

// BeginTotpPending 创建 2FA 待验证令牌，返回令牌。
func (s *AdminService) BeginTotpPending(adminID int64) string {
	token := models.RandomToken(24)
	s.mu.Lock()
	s.totp["2fa:"+token] = totpPending{adminID: adminID, expiry: time.Now().Add(5 * time.Minute)}
	s.mu.Unlock()
	return token
}

// TakeTotpPending 取出并消费 2FA 待验证令牌。
func (s *AdminService) TakeTotpPending(token string) (int64, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	info, ok := s.totp["2fa:"+token]
	if ok {
		delete(s.totp, "2fa:"+token)
	}
	if !ok || time.Now().After(info.expiry) {
		return 0, false
	}
	return info.adminID, true
}

// ClearPendingTotps 清空全部待验证令牌（恢复/重置后吊销）。
func (s *AdminService) ClearPendingTotps() {
	s.mu.Lock()
	s.totp = make(map[string]totpPending)
	s.mu.Unlock()
}

func (s *AdminService) LoginLocked(username string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loginFails[username].lockedUntil > time.Now().Unix()
}

// RecordLoginFail 记录一次登录失败；连续失败 5 次锁定 10 分钟。
func (s *AdminService) RecordLoginFail(username string) {
	now := time.Now().Unix()
	s.mu.Lock()
	defer s.mu.Unlock()
	g := s.loginFails[username]
	g.fails++
	g.lastAttempt = now
	if g.fails >= 5 {
		g.lockedUntil = now + 600
		g.fails = 0
	}
	s.loginFails[username] = g
}

// ClearLoginFails 登录成功后清除失败记录。
func (s *AdminService) ClearLoginFails(username string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	delete(s.loginFails, username)
}
