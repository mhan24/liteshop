#!/bin/sh
# 每天备份，保留最近 BACKUP_KEEP 份。周日额外做完整恢复演练。
set -eu
umask 077

export PGHOST="${DB_HOST:-db}" PGUSER="${DB_USER:-liteshop}" PGDATABASE="${DB_NAME:-liteshop}"
KEEP="${BACKUP_KEEP:-14}"
cd "${BACKUP_DIR:-/backups}"
case "$KEEP" in ''|*[!0-9]*) echo "BACKUP_KEEP 必须为正整数" >&2; exit 1;; esac
[ "$KEEP" -gt 0 ] || { echo "BACKUP_KEEP 必须为正整数" >&2; exit 1; }

log() { echo "[backup] $(date '+%F %T') $*"; }

status() {
  printf '{"time":"%s","result":"%s","message":"%s"}\n' "$(date -Iseconds)" "$1" "$2" > "$work/status" &&
    mv "$work/status" status.json
}

dump_for_drill() (
  cd "$work" || exit 1
  # psql 保持导出快照的事务，前台 pg_dump 和行数查询看到同一份数据。
  psql -XqAt -v ON_ERROR_STOP=1 <<'SQL' || exit 1
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SELECT pg_export_snapshot() AS snapshot \gset
\setenv LITESHOP_SNAPSHOT :snapshot
\o counts
SELECT (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public.cards), (SELECT count(*) FROM public.deliveries);
\o
\! pg_dump --snapshot="$LITESHOP_SNAPSHOT" -Fc -f archive && touch dump-complete
COMMIT;
SQL
  [ -f dump-complete ]
)

restore_drill() (
  check_db="liteshop_restore_${work##*.}"
  log "恢复演练：$check_db"
  createdb "$check_db" || exit 1
  trap 'rc=$?; dropdb "$check_db" || rc=1; exit "$rc"' EXIT
  pg_restore -d "$check_db" --no-owner --exit-on-error "$work/archive" || exit 1
  counts=$(psql -XqAt -v ON_ERROR_STOP=1 -d "$check_db" -c 'SELECT (SELECT count(*) FROM public.orders), (SELECT count(*) FROM public.cards), (SELECT count(*) FROM public.deliveries)') || exit 1
  expected=$(cat "$work/counts") || exit 1
  [ -n "$counts" ] && [ "$counts" = "$expected" ]
)

run_once() (
  ts=$(date +%Y%m%d-%H%M%S)
  work=$(mktemp -d ".liteshop-$ts.XXXXXX") || exit 1
  trap 'rm -rf "$work"' EXIT
  file="${work#.}.dump"
  result="备份 $ts"
  drill=0
  if [ "$(date +%u)" = 7 ] || [ "${FORCE_DRILL:-0}" = 1 ]; then drill=1; fi
  if [ "$drill" = 1 ]; then
    dump_for_drill || { status fail "快照备份失败"; exit 1; }
  else
    pg_dump -Fc -f "$work/archive" || { status fail "pg_dump 失败"; exit 1; }
  fi
  if ! pg_restore -l "$work/archive" > /dev/null; then
    status fail "备份文件损坏"; exit 1
  fi
  if [ "$drill" = 1 ]; then
    if ! restore_drill; then
      status fail "备份 $ts 恢复演练失败"; exit 1
    fi
    result="${result}，恢复演练通过"
  fi
  if ! ln "$work/archive" "$file"; then
    status fail "无法保存备份 $ts"; exit 1
  fi
  log "已备份 $file"
  # shell 通配符按文件名排序。清理最旧的文件，多次并发删除同一路径是幂等的。
  set -- liteshop-*.dump
  while [ "$#" -gt "$KEEP" ]; do
    rm -f "./$1" || exit 1
    shift
  done
  status ok "$result"
)

if [ "${1:-}" = "--once" ]; then
  run_once
  exit $?
fi
while true; do
  run_once || log "备份失败，24 小时后重试"
  sleep 86400
done
