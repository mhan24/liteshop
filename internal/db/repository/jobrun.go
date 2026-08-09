package repository

import (
	"database/sql"

	"shop/internal/models"
)

// RecordJobRun 写入一次任务执行记录（status 由 err 推导：ok / error）。
func RecordJobRun(d *sql.DB, jobName string, startedAt, finishedAt int64, err error) error {
	status := models.JobRunOK
	errMsg := ""
	if err != nil {
		status = models.JobRunError
		errMsg = err.Error()
	}
	_, e := d.Exec(`INSERT INTO job_runs(job_name, started_at, finished_at, status, error) VALUES(?, ?, ?, ?, ?)`,
		jobName, startedAt, finishedAt, status, errMsg)
	return e
}

// LatestJobRuns 返回每个任务的最新一次执行记录。
func LatestJobRuns(d *sql.DB) ([]models.JobRun, error) {
	rows, err := d.Query(`SELECT id, job_name, started_at, finished_at, status, error
		FROM job_runs WHERE id IN (SELECT MAX(id) FROM job_runs GROUP BY job_name)
		ORDER BY job_name`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []models.JobRun{}
	for rows.Next() {
		var r models.JobRun
		if err := rows.Scan(&r.ID, &r.JobName, &r.StartedAt, &r.FinishedAt, &r.Status, &r.Error); err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, rows.Err()
}

// DeleteOldJobRuns 清理超过保留期的任务执行记录（防高频任务导致表无限增长）。
func DeleteOldJobRuns(d *sql.DB, cutoff int64) error {
	_, err := d.Exec(`DELETE FROM job_runs WHERE finished_at < ?`, cutoff)
	return err
}
