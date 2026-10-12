#!/bin/sh
#
# 安装/修复运维定时任务（幂等，可重复执行）。
#
# 背景：定时任务指向的脚本必须存在于**部署后仍在**的路径。
# 之前脚本放在 /opt/liteshop/ 根下且未入库，被 rsync --delete 删除后
# 超时清扫与自动备份同时静默失效。现改为：
#   - 脚本纳入仓库（scripts/ops/）
#   - crontab 指向部署同步后的实际路径
#
# 用法（在服务器上）：/opt/liteshop/scripts/ops/install-cron.sh

set -eu

APP_DIR="${LITESHOP_APP_DIR:-/opt/liteshop}"

EXPIRE="$APP_DIR/scripts/ops/expire-cron.sh"
BACKUP="$APP_DIR/scripts/ops/backup-cron.sh"
LOG="${LITESHOP_CRON_LOG:-/var/log/liteshop-cron.log}"

for f in "$EXPIRE" "$BACKUP"; do
  if [ ! -f "$f" ]; then
    echo "✗ 缺少脚本：${f} (请先执行 deploy.sh 同步仓库)" >&2
    exit 1
  fi
  chmod +x "$f"
done

touch "$LOG"

# 幂等安装：先移除同名旧条目，再写入
TMP=$(mktemp)
crontab -l 2>/dev/null | grep -v 'liteshop' > "$TMP" || true
cat >> "$TMP" <<EOF
*/5 * * * * $EXPIRE >> $LOG 2>&1
30 3 * * * $BACKUP >> $LOG 2>&1
EOF
crontab "$TMP"
rm -f "$TMP"

echo "✓ crontab 已安装："
crontab -l | grep liteshop | sed 's/^/  /'
