#!/bin/sh
# 异地备份（offsite 容器内运行，rclone/rclone 官方镜像）：
# 每天把 /backups 下的数据库备份上传到 rclone 远端 offsite:，远端保留 OFFSITE_KEEP_DAYS 天。
#
# 远端完全由 .env.offsite 里的 RCLONE_CONFIG_OFFSITE_* 环境变量定义（模板见 .env.offsite.example），
# 推荐用 crypt 远端包一层：文件在本机加密后才上传，存储服务商只看到密文。
# 未配置时只打印提醒，不做任何事。
set -eu

KEEP_DAYS="${OFFSITE_KEEP_DAYS:-30}"
log() { echo "[offsite] $(date '+%F %T') $*"; }

if [ -z "${RCLONE_CONFIG_OFFSITE_TYPE:-}" ]; then
  log "未配置异地备份（缺少 .env.offsite），备份只在本机，硬盘故障会一起丢失"
  exec sleep infinity
fi

case "$KEEP_DAYS" in ''|*[!0-9]*) echo "OFFSITE_KEEP_DAYS 必须为正整数" >&2; exit 1;; esac
[ "$KEEP_DAYS" -gt 0 ] || { echo "OFFSITE_KEEP_DAYS 必须为正整数" >&2; exit 1; }

sync_once() {
  # 只传完整的 .dump（.tmp 是正在写的文件）
  rclone copy /backups offsite: --include "liteshop-*.dump" --max-age "${KEEP_DAYS}d" --immutable --stats-one-line -v || return 1
  recent=$(rclone lsf offsite: --files-only --include "liteshop-*.dump" --max-age "${KEEP_DAYS}d") || return 1
  if [ -z "$recent" ]; then
    log "远端没有保留期内的备份，保留现有文件"
    return 1
  fi
  rclone delete offsite: --include "liteshop-*.dump" --min-age "${KEEP_DAYS}d" || return 1
  newest=$(printf '%s\n' "$recent" | sort | tail -n 1)
  log "同步完成，远端最新：$newest"
}

if [ "${1:-}" = "--once" ]; then
  sync_once
  exit $?
fi
# 错开本地备份时间（本地备份在容器启动时立即执行一次）
sleep 600
while true; do
  sync_once || log "同步失败，24 小时后重试"
  sleep 86400
done
