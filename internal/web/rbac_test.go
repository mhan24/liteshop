package web

import (
	"testing"

	"shop/internal/db"
	"shop/internal/models"
)

func TestAdminRolesAndAudit(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	if err := db.SeedAdmin(d, "admin1", "password123"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// 验证种子 admin 是 admin 角色
	var role string
	_ = d.QueryRow(`SELECT role FROM admins WHERE username='admin1'`).Scan(&role)
	if role != models.RoleAdmin {
		t.Fatalf("seed role = %s, want admin", role)
	}

	// 创建 operator
	if _, err := d.Exec(`INSERT INTO admins(username, password_hash, role, created_at) VALUES('op1', ?, 'operator', ?)`, models.HashPassword("password123"), models.Now()); err != nil {
		t.Fatalf("insert op: %v", err)
	}
	// 创建 viewer
	if _, err := d.Exec(`INSERT INTO admins(username, password_hash, role, created_at) VALUES('view1', ?, 'viewer', ?)`, models.HashPassword("password123"), models.Now()); err != nil {
		t.Fatalf("insert viewer: %v", err)
	}

	// 审计日志写入
	if err := db.AddAuditLog(d, 1, "admin1", "product_create", "product", "测试商品", "", "price=100"); err != nil {
		t.Fatalf("audit: %v", err)
	}
	logs, err := db.AuditLogs(d, 10)
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	if len(logs) != 1 || logs[0].Action != "product_create" || logs[0].Username != "admin1" {
		t.Fatalf("audit log mismatch: %+v", logs)
	}
}

func TestRoleRank(t *testing.T) {
	if roleRank(models.RoleViewer) >= roleRank(models.RoleOperator) {
		t.Fatal("viewer should rank below operator")
	}
	if roleRank(models.RoleOperator) >= roleRank(models.RoleAdmin) {
		t.Fatal("operator should rank below admin")
	}
}
