package db

import (
	"errors"
	"testing"

	admindomain "shop/internal/modules/admin/domain"
	adminsqlite "shop/internal/modules/admin/repository/sqlite"
	coupondomain "shop/internal/modules/coupon/domain"
	couponsqlite "shop/internal/modules/coupon/repository/sqlite"
	settingssqlite "shop/internal/modules/settings/repository/sqlite"
	mailqueue "shop/internal/platform/mailqueue"
	"shop/internal/shared/clock"
)

func TestJobRunsRecordAndLatest(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()

	if err := adminsqlite.RecordJobRun(d, "backup", 100, 200, nil); err != nil {
		t.Fatalf("record ok: %v", err)
	}
	if err := adminsqlite.RecordJobRun(d, "backup", 300, 400, errors.New("boom")); err != nil {
		t.Fatalf("record err: %v", err)
	}
	if err := adminsqlite.RecordJobRun(d, "cleanup", 150, 250, nil); err != nil {
		t.Fatalf("record cleanup: %v", err)
	}

	runs, err := adminsqlite.LatestJobRuns(d)
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("latest runs = %d, want 2", len(runs))
	}
	byName := map[string]admindomain.JobRun{}
	for _, r := range runs {
		byName[r.JobName] = r
	}
	if byName["backup"].Status != admindomain.JobRunError || byName["backup"].Error == "" {
		t.Fatalf("backup latest should be error: %+v", byName["backup"])
	}
	if byName["cleanup"].Status != admindomain.JobRunOK {
		t.Fatalf("cleanup latest should be ok: %+v", byName["cleanup"])
	}
}

func TestPendingMailCount(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	if err := mailqueue.EnqueueMail(d, "a@b.com", "S", "B", 0, 0); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if err := mailqueue.EnqueueMail(d, "c@d.com", "S", "B", 0, 0); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	n, err := mailqueue.PendingMailCount(d)
	if err != nil || n != 2 {
		t.Fatalf("pending = %d (%v), want 2", n, err)
	}
	items, _ := mailqueue.DueMails(d, 1<<62)
	if len(items) != 2 {
		t.Fatalf("due = %d, want 2", len(items))
	}
	_ = mailqueue.MarkMailSent(d, items[0].ID)
	n, _ = mailqueue.PendingMailCount(d)
	if n != 1 {
		t.Fatalf("pending after sent = %d, want 1", n)
	}
}

func TestDeleteStaleMailQueue(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := clock.Now()
	// 失败超上限且超 30 天（应删）、失败超上限但新（保留）、失败未超上限但旧（保留）
	_, _ = d.Exec(`INSERT INTO mail_queue(to_email, subject, body, order_id, attempts, next_retry_at, created_at)
		VALUES('a@b.com','s','b',0,5,0,?)`, now-40*86400)
	_, _ = d.Exec(`INSERT INTO mail_queue(to_email, subject, body, order_id, attempts, next_retry_at, created_at)
		VALUES('c@d.com','s','b',0,5,0,?)`, now-86400)
	_, _ = d.Exec(`INSERT INTO mail_queue(to_email, subject, body, order_id, attempts, next_retry_at, created_at)
		VALUES('e@f.com','s','b',0,1,0,?)`, now-40*86400)
	if err := mailqueue.DeleteStaleMailQueue(d, now-30*86400); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM mail_queue`).Scan(&n)
	if n != 2 {
		t.Fatalf("rows after cleanup = %d, want 2", n)
	}
}

func TestResetAllTablesScope(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := clock.Now()
	_, _ = d.Exec(`INSERT INTO secrets(key, value, updated_at) VALUES('k','v',?)`, now)
	_, _ = d.Exec(`INSERT INTO sessions(id, admin_id, expires_at) VALUES('s1',1,?)`, now)
	_, _ = d.Exec(`INSERT INTO outbox_events(event_type, payload, created_at) VALUES('t','{}',?)`, now)
	_, _ = d.Exec(`INSERT INTO processed_events(event_key, event_type, processed_at) VALUES('k1','p',?)`, now)
	_, _ = d.Exec(`INSERT INTO job_runs(job_name, started_at, finished_at, status, error) VALUES('j',?,?,'ok','')`, now, now)
	_, _ = d.Exec(`INSERT INTO dead_events(event_type, payload, created_at, dead_at, reason) VALUES('t','{}',?,?,'r')`, now, now)
	if err := settingssqlite.ResetAllTables(d); err != nil {
		t.Fatalf("reset: %v", err)
	}
	for _, tbl := range []string{"secrets", "sessions", "outbox_events", "processed_events", "job_runs", "dead_events", "orders"} {
		var n int
		_ = d.QueryRow(`SELECT COUNT(1) FROM ` + tbl).Scan(&n)
		if n != 0 {
			t.Fatalf("table %s not cleared: %d rows", tbl, n)
		}
	}
	var v int
	_ = d.QueryRow(`SELECT COALESCE(MAX(version),0) FROM settings_version`).Scan(&v)
	if v == 0 {
		t.Fatal("settings_version must be preserved after reset")
	}
}

func TestUniqueViolationMapped(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	// 管理员用户名冲突 → ErrUsernameTaken
	if _, err := adminsqlite.SeedAdmin(d, "admin1", "pw123456"); err != nil {
		t.Fatalf("seed: %v", err)
	}
	if err := adminsqlite.CreateAdmin(d, "admin2", "hash", "operator"); err != nil {
		t.Fatalf("create admin2: %v", err)
	}
	admins, err := adminsqlite.ListAdmins(d)
	if err != nil {
		t.Fatalf("list: %v", err)
	}
	var id2 int64
	for _, a := range admins {
		if a.Username == "admin2" {
			id2 = a.ID
		}
	}
	if err := adminsqlite.UpdateAdminAccount(d, id2, "admin1", "hash"); !errors.Is(err, admindomain.ErrUsernameTaken) {
		t.Fatalf("duplicate username err = %v, want ErrUsernameTaken", err)
	}
	// 优惠券码冲突 → ErrCouponExists
	repo := couponsqlite.NewCouponRepository(d)
	_ = repo.CreateCoupon(coupondomain.Coupon{Code: "A", Type: "fixed", ValueCents: 100, Active: true})
	_ = repo.CreateCoupon(coupondomain.Coupon{Code: "B", Type: "fixed", ValueCents: 100, Active: true})
	coupons, _ := repo.ListCoupons()
	var bid int64
	for _, c := range coupons {
		if c.Code == "B" {
			bid = c.ID
		}
	}
	cerr := repo.UpdateCoupon(coupondomain.Coupon{ID: bid, Code: "A", Type: "fixed", ValueCents: 100, Active: true})
	if !errors.Is(cerr, coupondomain.ErrCouponExists) {
		t.Fatalf("duplicate coupon err = %v, want ErrCouponExists", cerr)
	}
	// 改为新码应成功且生效（回归：UpdateCoupon 曾漏更 code 列）
	if err := repo.UpdateCoupon(coupondomain.Coupon{ID: bid, Code: "C", Type: "fixed", ValueCents: 100, Active: true}); err != nil {
		t.Fatalf("update coupon to new code: %v", err)
	}
	coupons, _ = repo.ListCoupons()
	var found bool
	for _, c := range coupons {
		if c.ID == bid && c.Code == "C" {
			found = true
		}
	}
	if !found {
		t.Fatal("coupon code not persisted after update")
	}
}

func TestDeleteOldJobRuns(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	now := clock.Now()
	_ = adminsqlite.RecordJobRun(d, "backup", now-8*86400, now-8*86400+5, nil)
	_ = adminsqlite.RecordJobRun(d, "backup", now-86400, now-86400+5, nil)
	if err := adminsqlite.DeleteOldJobRuns(d, now-7*86400); err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	var n int
	_ = d.QueryRow(`SELECT COUNT(1) FROM job_runs`).Scan(&n)
	if n != 1 {
		t.Fatalf("job_runs after cleanup = %d, want 1", n)
	}
}
