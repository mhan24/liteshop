#!/usr/bin/env bash
# 第十六条：通过目录限制跨模块调用。
# 1) 模块 / 集成 / 平台代码不得 import 其他模块的 repository/sqlite 实现；
#    允许：组合根 internal/app、测试文件、迁移层 schema（迁移天然跨表）。
# 2) 模块仓储不得直接读写其他模块拥有的业务表；跨表操作必须经端口注入
#    或应用层编排（组合根只做装配）。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== 1/2 跨模块仓储导入检查 =="
imports=$(grep -rn '"shop/internal/modules/[a-z]*/repository/sqlite"' \
  --include='*.go' internal integrations \
  | grep -v '_test.go' \
  | grep -v '^internal/app/' \
  | grep -v '^internal/platform/database/sqlite/schema/' || true)
if [ -n "$imports" ]; then
  echo "!! 以下文件跨模块 import 了仓储实现（应改为端口注入 + 组合根装配）："
  echo "$imports"
  fail=1
else
  echo "OK 无跨模块仓储导入"
fi

echo "== 2/2 核心业务表归属检查 =="
# 表 -> 归属模块。platform 为共享基础设施表（允许各模块读写）；
# 其余业务表只允许归属模块直接读写，跨模块必须走接口/应用用例。
owner_of() {
  case "$1" in
    orders|order_logs|order_status_history|payment_transactions) echo order ;;
    products|product_categories) echo product ;;
    cards|card_reservations) echo inventory ;;
    coupons|coupon_usages) echo coupon ;;
    audit_logs) echo audit ;;
    settings|secrets|settings_version) echo settings ;;
    admins|sessions) echo admin ;;
    outbox_events|processed_events|dead_events|mail_queue|job_runs|schema_migrations) echo platform ;;
    low_stock_reminders) echo notify ;;
    sqlite_sequence) echo system ;;
  esac
}
while IFS= read -r f; do
  [ -z "$f" ] && continue
  mod=$(echo "$f" | awk -F/ '{print $3}')
  while IFS= read -r tbl; do
    [ -z "$tbl" ] && continue
    own=$(owner_of "$tbl")
    if [ -n "$own" ] && [ "$own" != "$mod" ] \
      && [ "$own" != "platform" ] && [ "$own" != "system" ] && [ "$own" != "notify" ]; then
      echo "!! $f: 直接访问 ${tbl}（归属 ${own} 模块，本模块为 ${mod}）"
      fail=1
    fi
  done < <(grep -oE '(FROM|INTO|UPDATE|JOIN|DELETE FROM)[[:space:]]+[a-z_]+' "$f" \
    | awk '{print $2}' | sort -u)
done < <(find internal/modules -name '*.go' ! -name '*_test.go')

if [ "$fail" -eq 0 ]; then
  echo "OK 各模块仓储只读写本模块业务表"
fi

exit $fail
