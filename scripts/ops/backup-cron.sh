#!/bin/sh
#
# 每日在线一致性备份（由 crontab 每天 03:30 调用）。
#
# 为什么纳入仓库：见 expire-cron.sh 的说明（脚本原先放在被 rsync --delete
# 覆盖的目录中，部署时被删除，导致自动备份静默失效）。
#
# 流程：容器内 VACUUM INTO 生成一致性快照 → 拷到宿主机 → 校验 → 清理旧备份。
# 备份**存放在宿主机目录**而非数据卷内，避免与数据同盘损坏。

set -eu

ENV_FILE="${LITESHOP_ENV_FILE:-/opt/liteshop/.env}"
CONTAINER="${LITESHOP_CONTAINER:-liteshop-liteshop-1}"
IMAGE="${LITESHOP_IMAGE:-liteshop-liteshop:latest}"
HOST_BACKUP_DIR="${LITESHOP_BACKUP_DIR:-/root/liteshop-backups/daily}"
RETENTION_DAYS="${LITESHOP_BACKUP_RETENTION_DAYS:-14}"

mkdir -p "$HOST_BACKUP_DIR"
STAMP=$(date +%Y%m%d-%H%M%S)
NAME="liteshop-$STAMP.db"

# 1) 容器内生成一致性快照（VACUUM INTO 免停机，且正确包含 WAL 内容）
if ! docker exec "$CONTAINER" node -e "
const Database=require('better-sqlite3');
const fs=require('fs');
fs.mkdirSync('/app/data/backups',{recursive:true});
const src=new Database('/app/data/liteshop.db',{readonly:true});
src.exec(\"VACUUM INTO '/app/data/backups/$NAME'\");
src.close();
" >/dev/null 2>&1; then
  echo "$(date -Is) 备份失败：容器内快照生成失败" >&2
  exit 1
fi

# 2) 取到宿主机并清理容器内临时文件
if ! docker cp "$CONTAINER:/app/data/backups/$NAME" "$HOST_BACKUP_DIR/$NAME" >/dev/null 2>&1; then
  echo "$(date -Is) 备份失败：导出到宿主机失败" >&2
  docker exec "$CONTAINER" rm -f "/app/data/backups/$NAME" >/dev/null 2>&1 || true
  exit 1
fi
docker exec "$CONTAINER" rm -f "/app/data/backups/$NAME" >/dev/null 2>&1 || true

# 3) 校验可读性与完整性（坏备份比没有备份更危险）
if ! docker run --rm -v "$HOST_BACKUP_DIR:/b:ro" --entrypoint node "$IMAGE" -e "
const d=require('better-sqlite3')('/b/$NAME',{readonly:true});
const ok=d.pragma('integrity_check')[0].integrity_check;
const fk=d.pragma('foreign_key_check');
d.close();
if (ok!=='ok'||fk.length!==0) process.exit(1);
" >/dev/null 2>&1; then
  echo "$(date -Is) 备份校验失败，已删除损坏文件：$NAME" >&2
  rm -f "$HOST_BACKUP_DIR/$NAME"
  exit 1
fi

echo "$(date -Is) backup ok: $NAME"

# 4) 保留最近 N 天
find "$HOST_BACKUP_DIR" -name 'liteshop-*.db' -type f -mtime "+$RETENTION_DAYS" -delete 2>/dev/null || true

exit 0
