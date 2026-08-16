#!/usr/bin/env bash
# 第十九条：迁移路线图门禁。
# 校验 docs/migration-roadmap.md 存在，且四个阶段与待办项（支付对账）完整记录，
# 防止迁移计划被无声删除或降级。
set -euo pipefail
cd "$(dirname "$0")/.."

roadmap="docs/migration-roadmap.md"
if [ ! -f "$roadmap" ]; then
  echo "!! 缺少 docs/migration-roadmap.md（第十九条迁移路线图）"
  exit 1
fi

fail=0
for phase in "第一阶段" "第二阶段" "第三阶段" "第四阶段"; do
  if ! grep -q "$phase" "$roadmap"; then
    echo "!! $roadmap 缺少 $phase"
    fail=1
  fi
done
if ! grep -q "支付对账" "$roadmap"; then
  echo "!! $roadmap 未记录第一阶段待办：支付对账"
  fail=1
fi

if [ "$fail" -eq 0 ]; then
  echo "OK 迁移路线图存在且四阶段完整（第一阶段待办：支付对账）"
fi
exit $fail
