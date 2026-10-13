#!/bin/sh
#
# 交易所到账扫描（由 crontab 每分钟调用）。
#
# 交易所（Binance/OKX）不提供支付 webhook —— 买家是「内部转账到收款账户」，
# 到账只能靠轮询账户流水发现。因此需要每分钟触发一次：
#   * * * * * /opt/liteshop/scripts/ops/exchange-cron.sh >> /var/log/liteshop-cron.log 2>&1
#
# 与超时清扫脚本同源：纳入版本控制，避免被 rsync --delete 删除导致静默失效。
#
# 幂等：仅触发扫描。同一笔到账的重复处理由服务端幂等保证，重复执行安全。
# 成本控制：没有待支付的交易所订单时服务端直接跳过，不会空转消耗
# 交易所 API 配额（币安该接口 Weight 很高）。

set -eu

ENV_FILE="${LITESHOP_ENV_FILE:-/opt/liteshop/.env}"
ENDPOINT="${LITESHOP_EXCHANGE_CRON_URL:-http://127.0.0.1:3000/api/cron/exchange}"

SECRET=$(grep '^CRON_SECRET=' "$ENV_FILE" 2>/dev/null | cut -d= -f2 | tr -d '\r\n')
if [ -z "${SECRET:-}" ]; then
  echo "$(date -Is) CRON_SECRET 未配置，跳过交易所扫描" >&2
  exit 1
fi

if ! curl -fsS -m 60 -H "x-cron-secret: $SECRET" "$ENDPOINT" >/dev/null; then
  echo "$(date -Is) 交易所扫描端点调用失败：$ENDPOINT" >&2
  exit 1
fi

exit 0