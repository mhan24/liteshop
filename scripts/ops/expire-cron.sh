#!/bin/sh
#
# 超时订单清扫（由 crontab 每 5 分钟调用）。
#
# 为什么纳入仓库：此前该脚本是手工放在服务器 /opt/liteshop/ 下的，
# 而 deploy 使用 rsync --delete 让目标目录严格等于提交内容，
# 于是脚本在部署时被删除，cron 静默失败（超时清扫与自动备份同时中断）。
# 纳入版本控制后，部署会把它同步回来，且改动可审查、可追溯。
#
# 幂等：仅触发清扫，重复执行无副作用。

set -eu

ENV_FILE="${LITESHOP_ENV_FILE:-/opt/liteshop/.env}"
ENDPOINT="${LITESHOP_CRON_URL:-http://127.0.0.1:3000/api/cron/expire}"

SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '\r\n')
if [ -z "${SECRET:-}" ]; then
  echo "$(date -Is) CRON_SECRET 未配置，跳过清扫" >&2
  exit 1
fi

if ! curl -fsS -m 30 -H "x-cron-secret: $SECRET" "$ENDPOINT" >/dev/null; then
  echo "$(date -Is) 清扫端点调用失败：$ENDPOINT" >&2
  exit 1
fi

exit 0
