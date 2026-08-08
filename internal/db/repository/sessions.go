package repository

import "database/sql"

// CreateSession 创建持久化会话。
func CreateSession(d *sql.DB, id string, adminID int64, expiresAt int64) error {
	_, err := d.Exec(`INSERT INTO sessions(id, admin_id, expires_at) VALUES(?, ?, ?)`, id, adminID, expiresAt)
	return err
}

// SessionAdminID 返回会话对应的管理员 ID 与过期时间。
func SessionAdminID(d *sql.DB, id string) (adminID, expiresAt int64, err error) {
	err = d.QueryRow(`SELECT admin_id, expires_at FROM sessions WHERE id = ?`, id).Scan(&adminID, &expiresAt)
	return
}

// SlideSessionExpiry 延长会话过期时间。
func SlideSessionExpiry(d *sql.DB, id string, expiresAt int64) error {
	_, err := d.Exec(`UPDATE sessions SET expires_at = ? WHERE id = ?`, expiresAt, id)
	return err
}

// DeleteSession 删除单个会话。
func DeleteSession(d *sql.DB, id string) error {
	_, err := d.Exec(`DELETE FROM sessions WHERE id = ?`, id)
	return err
}

// DeleteExpiredSessions 删除过期会话。
func DeleteExpiredSessions(d *sql.DB, now int64) error {
	_, err := d.Exec(`DELETE FROM sessions WHERE expires_at < ?`, now)
	return err
}

// DeleteSessionsByAdmin 删除某管理员全部会话。
func DeleteSessionsByAdmin(d *sql.DB, adminID int64) error {
	_, err := d.Exec(`DELETE FROM sessions WHERE admin_id = ?`, adminID)
	return err
}

// DeleteAllSessions 删除全部会话（恢复/重置后吊销所有登录）。
func DeleteAllSessions(d *sql.DB) error {
	_, err := d.Exec(`DELETE FROM sessions`)
	return err
}
