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
