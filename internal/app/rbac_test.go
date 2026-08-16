package app

import (
	"shop/internal/models"
	admindomain "shop/internal/modules/admin/domain"
	adminsqlite "shop/internal/modules/admin/repository/sqlite"
	auditsqlite "shop/internal/modules/audit/repository/sqlite"
	"testing"

	db "shop/internal/platform/database/sqlite"
)

func TestAdminRolesAndAudit(t *testing.T) {
	d, err := db.Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open db: %v", err)
	}
	defer d.Close()
	if _, err := adminsqlite.SeedAdmin(d, "admin1", "password123"); err != nil {
		t.Fatalf("seed: %v", err)
	}

	// 验证种子 admin 是 admin 角色
	var role string
	_ = d.QueryRow(`SELECT role FROM admins WHERE username='admin1'`).Scan(&role)
	if role != admindomain.RoleAdmin {
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
	if err := auditsqlite.AddAuditLog(d, 1, "admin1", "product_create", "product", "测试商品", "", "price=100"); err != nil {
		t.Fatalf("audit: %v", err)
	}
	logs, err := auditsqlite.AuditLogs(d, 10)
	if err != nil {
		t.Fatalf("logs: %v", err)
	}
	if len(logs) != 1 || logs[0].Action != "product_create" || logs[0].Username != "admin1" {
		t.Fatalf("audit log mismatch: %+v", logs)
	}
}

func TestRoleRank(t *testing.T) {
	if roleRank(admindomain.RoleViewer) >= roleRank(admindomain.RoleOperator) {
		t.Fatal("viewer should rank below operator")
	}
	if roleRank(admindomain.RoleOperator) >= roleRank(admindomain.RoleAdmin) {
		t.Fatal("operator should rank below admin")
	}
}
