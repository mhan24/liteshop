-- 018_job_runs.sql - 后台任务执行记录（排查/后台展示用）
CREATE TABLE IF NOT EXISTS job_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    job_name TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    finished_at INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'running',  -- running / ok / error
    error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_job_runs_name ON job_runs(job_name, id);
