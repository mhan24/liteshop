package db

import (
	"errors"
	"testing"

	"shop/internal/db/repository"
	"shop/internal/models"
)

func TestJobRunsRecordAndLatest(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()

	if err := repository.RecordJobRun(d, "backup", 100, 200, nil); err != nil {
		t.Fatalf("record ok: %v", err)
	}
	if err := repository.RecordJobRun(d, "backup", 300, 400, errors.New("boom")); err != nil {
		t.Fatalf("record err: %v", err)
	}
	if err := repository.RecordJobRun(d, "cleanup", 150, 250, nil); err != nil {
		t.Fatalf("record cleanup: %v", err)
	}

	runs, err := repository.LatestJobRuns(d)
	if err != nil {
		t.Fatalf("latest: %v", err)
	}
	if len(runs) != 2 {
		t.Fatalf("latest runs = %d, want 2", len(runs))
	}
	byName := map[string]models.JobRun{}
	for _, r := range runs {
		byName[r.JobName] = r
	}
	if byName["backup"].Status != models.JobRunError || byName["backup"].Error == "" {
		t.Fatalf("backup latest should be error: %+v", byName["backup"])
	}
	if byName["cleanup"].Status != models.JobRunOK {
		t.Fatalf("cleanup latest should be ok: %+v", byName["cleanup"])
	}
}

func TestPendingMailCount(t *testing.T) {
	d, err := Open(t.TempDir() + "/test.db")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	defer d.Close()
	if err := repository.EnqueueMail(d, "a@b.com", "S", "B", 0, 0); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	if err := repository.EnqueueMail(d, "c@d.com", "S", "B", 0, 0); err != nil {
		t.Fatalf("enqueue: %v", err)
	}
	n, err := repository.PendingMailCount(d)
	if err != nil || n != 2 {
		t.Fatalf("pending = %d (%v), want 2", n, err)
	}
	items, _ := repository.DueMails(d, 1<<62)
	if len(items) != 2 {
		t.Fatalf("due = %d, want 2", len(items))
	}
	_ = repository.MarkMailSent(d, items[0].ID)
	n, _ = repository.PendingMailCount(d)
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
	now := models.Now()
	// 失败超上限且超 30 天（应删）、失败超上限但新（保留）、失败未超上限但旧（保留）
	_, _ = d.Exec(`INSERT INTO mail_queue(to_email, subject, body, order_id, attempts, next_retry_at, created_at)
		VALUES('a@b.com','s','b',0,5,0,?)`, now-40*86400)
	_, _ = d.Exec(`INSERT INTO mail_queue(to_email, subject, body, order_id, attempts, next_retry_at, created_at)
		VALUES('c@d.com','s','b',0,5,0,?)`, now-86400)
	_, _ = d.Exec(`INSERT INTO mail_queue(to_email, subject, body, order_id, attempts, next_retry_at, created_at)
		VALUES('e@f.com','s','b',0,1,0,?)`, now-40*86400)
	if err := repository.DeleteStaleMailQueue(d, now-30*86400); err != nil {
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
	now := models.Now()
	_, _ = d.Exec(`INSERT INTO secrets(key, value, updated_at) VALUES('k','v',?)`, now)
	_, _ = d.Exec(`INSERT INTO sessions(id, admin_id, expires_at) VALUES('s1',1,?)`, now)
	_, _ = d.Exec(`INSERT INTO outbox_events(event_type, payload, created_at) VALUES('t','{}',?)`, now)
	_, _ = d.Exec(`INSERT INTO processed_events(event_key, event_type, processed_at) VALUES('k1','p',?)`, now)
	_, _ = d.Exec(`INSERT INTO job_runs(job_name, started_at, finished_at, status, error) VALUES('j',?,?,'ok','')`, now, now)
	_, _ = d.Exec(`INSERT INTO dead_events(event_type, payload, created_at, dead_at, reason) VALUES('t','{}',?,?,'r')`, now, now)
	if err := repository.ResetAllTables(d); err != nil {
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
