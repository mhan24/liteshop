#!/bin/sh
# 数据库备份（backup 容器内运行，postgres:18-alpine）：
# - 每天 pg_dump 一份到 /backups，保留最近 14 份
# - 每份备份做目录完整性检查（pg_restore -l）
# - 每周日把最新备份完整恢复到临时库，核对 orders / cards 行数与线上一致（恢复演练）
# 结果写入 /backups/status.json，供 offsite 容器与人工排查读取。
set -eu

DB_HOST="${DB_HOST:-db}"
DB_USER="${DB_USER:-liteshop}"
DB_NAME="${DB_NAME:-liteshop}"
CHECK_DB="liteshop_restore_check"
KEEP="${BACKUP_KEEP:-14}"

log() { echo "[backup] $(date '+%F %T') $*"; }

status() { # $1=ok|fail $2=message
  printf '{"time":"%s","result":"%s","message":"%s"}\n' "$(date -Iseconds)" "$1" "$2" > /backups/status.json
}

count() { # $1=database $2=table
  psql -h "$DB_HOST" -U "$DB_USER" -d "$1" -Atc "SELECT count(*) FROM $2"
}

restore_drill() { # $1=dump file
  log "恢复演练：$1 → $CHECK_DB"
  psql -h "$DB_HOST" -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)"
  psql -h "$DB_HOST" -U "$DB_USER" -d postgres -qc "CREATE DATABASE $CHECK_DB"
  pg_restore -h "$DB_HOST" -U "$DB_USER" -d "$CHECK_DB" --no-owner --exit-on-error "$1"
  for t in orders cards deliveries; do
    restored=$(count "$CHECK_DB" "$t")
    live=$(count "$DB_NAME" "$t")
    # 备份之后线上可能新增了行：恢复数 ≤ 线上数，且线上数不应该比备份多出太多（>10% 说明备份过旧）
    if [ "$restored" -gt "$live" ] || [ $((live - restored)) -gt $((live / 10 + 50)) ]; then
      psql -h "$DB_HOST" -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)"
      return 1
    fi
    log "  $t: 备份 $restored / 线上 $live"
  done
  psql -h "$DB_HOST" -U "$DB_USER" -d postgres -qc "DROP DATABASE IF EXISTS $CHECK_DB WITH (FORCE)"
}

run_once() {
  ts=$(date +%Y%m%d-%H%M%S)
  file="/backups/liteshop-$ts.dump"
  if ! pg_dump -h "$DB_HOST" -U "$DB_USER" -d "$DB_NAME" -F c -f "$file.tmp"; then
    rm -f "$file.tmp"; log "pg_dump 失败"; status fail "pg_dump 失败"; return 1
  fi
  if ! pg_restore -l "$file.tmp" > /dev/null; then
    rm -f "$file.tmp"; log "备份文件损坏"; status fail "备份文件损坏"; return 1
  fi
  mv "$file.tmp" "$file"
  log "已备份 ${file}（$(du -h "$file" | cut -f1)）"
  ls -1t /backups/liteshop-*.dump 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -f

  if [ "$(date +%u)" = 7 ] || [ "${FORCE_DRILL:-0}" = 1 ]; then
    if restore_drill "$file"; then
      status ok "备份 ${ts}，恢复演练通过"
    else
      log "恢复演练失败"; status fail "备份 $ts 恢复演练失败"; return 1
    fi
  else
    status ok "备份 $ts"
  fi
}

if [ "${1:-}" = "--once" ]; then
  run_once
  exit $?
fi
while true; do
  run_once || true
  sleep 86400
done
