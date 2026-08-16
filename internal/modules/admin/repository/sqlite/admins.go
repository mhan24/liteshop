package sqlite

import (
	"database/sql"
	"shop/internal/modules/admin/domain"
	models "shop/internal/modules/admin/domain"
	"shop/internal/platform/security"
	"shop/internal/shared/clock"
	"strings"
)

// 领域错误收敛到 models（service 与 repository 共用）。
var (
	ErrAdminNotFound = domain.ErrAdminNotFound
	ErrLastAdmin     = domain.ErrLastAdmin
)

// HasAdmin 是否存在至少一个管理员。
func HasAdmin(d *sql.DB) bool {
	var count int
	if err := d.QueryRow(`SELECT COUNT(1) FROM admins`).Scan(&count); err != nil {
		return false
	}
	return count > 0
}

// SeedAdmin 创建初始管理员；已存在管理员时返回 (false, nil)。
// 返回是否实际插入，供调用方处理并发初始化。
func SeedAdmin(d *sql.DB, username, password string) (bool, error) {
	if HasAdmin(d) {
		return false, nil
	}
	_, err := d.Exec(`INSERT INTO admins(id, username, password_hash, role, created_at) VALUES(1, ?, ?, 'admin', ?)`, username, security.HashPassword(password), clock.Now())
	if err != nil {
		// 并发下可能已由另一请求插入，视为已初始化。
		if HasAdmin(d) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// SeedAdminTx 在调用方事务中创建初始管理员。
func SeedAdminTx(tx *sql.Tx, username, password string) (bool, error) {
	var count int
	if err := tx.QueryRow(`SELECT COUNT(1) FROM admins`).Scan(&count); err != nil {
		return false, err
	}
	if count > 0 {
		return false, nil
	}
	_, err := tx.Exec(`INSERT INTO admins(id, username, password_hash, role, created_at) VALUES(1, ?, ?, 'admin', ?)`, username, security.HashPassword(password), clock.Now())
	if err != nil {
		return false, err
	}
	return true, nil
}

// AdminByUsername 按用户名查询登录凭据。
func AdminByUsername(d *sql.DB, username string) (adminID int64, hash, totpSecret string, totpEnabled bool, err error) {
	err = d.QueryRow(`SELECT id, password_hash, totp_secret, totp_enabled FROM admins WHERE username = ?`, username).Scan(&adminID, &hash, &totpSecret, &totpEnabled)
	if err == sql.ErrNoRows {
		err = ErrAdminNotFound
	}
	return
}

// AdminRole 返回管理员角色。
func AdminRole(d *sql.DB, id int64) (string, error) {
	var role string
	err := d.QueryRow(`SELECT role FROM admins WHERE id = ?`, id).Scan(&role)
	return role, err
}

// AdminUsername 返回管理员用户名。
func AdminUsername(d *sql.DB, id int64) (string, error) {
	var name string
	err := d.QueryRow(`SELECT username FROM admins WHERE id = ?`, id).Scan(&name)
	return name, err
}

// AdminPasswordHash 返回管理员密码哈希。
func AdminPasswordHash(d *sql.DB, id int64) (string, error) {
	var hash string
	err := d.QueryRow(`SELECT password_hash FROM admins WHERE id = ?`, id).Scan(&hash)
	return hash, err
}

// UpdateAdminAccount 更新用户名与密码哈希。
func UpdateAdminAccount(d *sql.DB, id int64, username, hash string) error {
	_, err := d.Exec(`UPDATE admins SET username = ?, password_hash = ? WHERE id = ?`, username, hash, id)
	if isUniqueViolation(err) {
		return models.ErrUsernameTaken
	}
	return err
}

// AdminTOTP 返回管理员 TOTP 状态。
func AdminTOTP(d *sql.DB, id int64) (enabled bool, secret string, err error) {
	err = d.QueryRow(`SELECT totp_enabled, totp_secret FROM admins WHERE id = ?`, id).Scan(&enabled, &secret)
	return
}

// SetAdminTOTPSecret 设置 TOTP 密钥。
func SetAdminTOTPSecret(d *sql.DB, id int64, secret string) error {
	_, err := d.Exec(`UPDATE admins SET totp_secret = ? WHERE id = ?`, secret, id)
	return err
}

// SetAdminTOTPEnabled 设置 TOTP 启用状态。
func SetAdminTOTPEnabled(d *sql.DB, id int64, enabled bool) error {
	v := 0
	if enabled {
		v = 1
	}
	_, err := d.Exec(`UPDATE admins SET totp_enabled = ? WHERE id = ?`, v, id)
	return err
}

// ListAdmins 返回全部管理员。
func ListAdmins(d *sql.DB) ([]domain.AdminRow, error) {
	rows, err := d.Query(`SELECT id, username, role, created_at FROM admins ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []domain.AdminRow{}
	for rows.Next() {
		var row domain.AdminRow
		if err := rows.Scan(&row.ID, &row.Username, &row.Role, &row.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, row)
	}
	return out, rows.Err()
}

// AdminCountByRole 返回指定角色管理员数量。
func AdminCountByRole(d *sql.DB, role string) (int, error) {
	var n int
	err := d.QueryRow(`SELECT COUNT(1) FROM admins WHERE role = ?`, role).Scan(&n)
	return n, err
}

// CreateAdmin 创建管理员。
func CreateAdmin(d *sql.DB, username, passwordHash, role string) error {
	_, err := d.Exec(`INSERT INTO admins(username, password_hash, role, created_at) VALUES(?, ?, ?, ?)`, username, passwordHash, role, clock.Now())
	return err
}

// SetAdminRole 更新管理员角色。
func SetAdminRole(d *sql.DB, id int64, role string) error {
	_, err := d.Exec(`UPDATE admins SET role = ? WHERE id = ?`, role, id)
	return err
}

// SetAdminRoleGuarded 事务内更新角色，防止取消最后一个 admin。
func SetAdminRoleGuarded(d *sql.DB, id int64, role string) error {
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var before string
	if err := tx.QueryRow(`SELECT role FROM admins WHERE id = ?`, id).Scan(&before); err != nil {
		return err
	}
	if role != models.RoleAdmin {
		var admins int
		if err := tx.QueryRow(`SELECT COUNT(1) FROM admins WHERE role = 'admin'`).Scan(&admins); err != nil {
			return err
		}
		if admins <= 1 && before == models.RoleAdmin {
			return ErrLastAdmin
		}
	}
	if _, err := tx.Exec(`UPDATE admins SET role = ? WHERE id = ?`, role, id); err != nil {
		return err
	}
	return tx.Commit()
}

// DeleteAdmin 删除管理员。
func DeleteAdmin(d *sql.DB, id int64) error {
	_, err := d.Exec(`DELETE FROM admins WHERE id = ?`, id)
	return err
}

// isUniqueViolation 判断 SQLite UNIQUE 约束冲突。
func isUniqueViolation(err error) bool {
	return err != nil && strings.Contains(err.Error(), "UNIQUE constraint failed")
}
