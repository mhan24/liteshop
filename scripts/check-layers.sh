#!/usr/bin/env bash
# 第十八条：目录级质量底线。
# 1) 禁止退化目录（internal/service / repository / schema / utils / api 等全局大杂烩）；
# 2) 每个业务模块必须四层齐全：domain / application / transport/http / repository/sqlite；
# 3) 每个业务模块必须有自己的测试（核心规则与数据库行为）；
# 4) 行数底线：业务模块单文件 ≤400 行，全库单文件 ≤1000 行（防 3000 行单文件退化）。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== 1/4 退化目录检查 =="
degenerate=false
for d in internal/service internal/repository internal/schema internal/utils internal/api; do
  if [ -e "$d" ]; then
    echo "!! 退化目录存在: $d（应按模块拆分为 domain/application/transport/repository）"
    fail=1
    degenerate=true
  fi
done
[ "$degenerate" = false ] && echo "OK"

echo "== 2/4 业务模块四层结构 =="
layers_ok=true
for m in $(ls internal/modules 2>/dev/null); do
  [ -d "internal/modules/$m" ] || continue
  for layer in domain application transport/http repository/sqlite; do
    n=$(find "internal/modules/$m/$layer" -name '*.go' ! -name '*_test.go' 2>/dev/null | wc -l | tr -d ' ')
    if [ "$n" -eq 0 ]; then
      echo "!! 模块 $m 缺少层: $layer"
      fail=1
      layers_ok=false
    fi
  done
done
[ "$layers_ok" = true ] && echo "OK"

echo "== 3/4 模块测试覆盖 =="
tests_ok=true
for m in $(ls internal/modules 2>/dev/null); do
  [ -d "internal/modules/$m" ] || continue
  n=$(find "internal/modules/$m" -name '*_test.go' 2>/dev/null | wc -l | tr -d ' ')
  if [ "$n" -eq 0 ]; then
    echo "!! 模块 $m 无测试文件（需覆盖核心规则与数据库行为）"
    fail=1
    tests_ok=false
  fi
done
[ "$tests_ok" = true ] && echo "OK"

echo "== 4/4 文件行数上限 =="
lines_ok=true
while IFS= read -r f; do
  lines=$(wc -l < "$f" | tr -d ' ')
  case "$f" in
    internal/modules/*)
      if [ "$lines" -gt 400 ]; then
        echo "!! $f 超业务模块单文件上限 400 行（当前 $lines）"
        fail=1
        lines_ok=false
      fi
      ;;
    *)
      if [ "$lines" -gt 1000 ]; then
        echo "!! $f 超全库单文件上限 1000 行（当前 $lines）"
        fail=1
        lines_ok=false
      fi
      ;;
  esac
done < <(find cmd internal tests -name '*.go' ! -name '*_test.go')
[ "$lines_ok" = true ] && echo "OK"

exit $fail
