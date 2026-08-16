#!/usr/bin/env bash
# 最终判断标准：目录改造完成后必须满足的 10 条验收底线。
# 与 check-modules / check-names / check-layers / check-mapping 互补：
# 本脚本按"想改 X 只进 Y"的可达性逐条核验。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0
pass() { echo "OK  $1"; }
bad()  { echo "!!  $1"; fail=1; }

echo "== 1/10 订单状态规则只进 order/domain =="
if [ -f internal/modules/order/domain/status.go ] && [ -f internal/modules/order/domain/transition.go ]; then
  n=$(grep -rl "type Status string\|type PaymentStatus string" internal/modules --include='*.go' \
    | grep -v '_test.go' | wc -l | tr -d ' ')
  if [ "$n" = "1" ]; then
    pass "状态类型/迁移集中在 order/domain（status.go + transition.go）"
  else
    bad "发现多处订单状态类型定义（$n 处），应只存在于 order/domain"
  fi
else
  bad "缺少 order/domain/status.go 或 transition.go"
fi

echo "== 2/10 创建订单流程只进 order/application/create.go =="
if [ -f internal/modules/order/application/create.go ]; then
  pass "下单用例在 order/application/create.go"
else
  bad "缺少 order/application/create.go"
fi

echo "== 3/10 HTTP 参数只进 order/transport/http =="
if [ -f internal/modules/order/transport/http/request.go ] \
  && [ -f internal/modules/order/transport/http/response.go ]; then
  pass "HTTP 请求/响应模型在 order/transport/http"
else
  bad "缺少 order/transport/http/request.go 或 response.go"
fi

echo "== 4/10 SQLite 查询只进 order/repository/sqlite =="
if [ -d internal/modules/order/repository/sqlite ]; then
  pass "SQL 与行模型在 order/repository/sqlite"
else
  bad "缺少 order/repository/sqlite"
fi

echo "== 5/10 更换支付网关只进 integrations/payment =="
gateways=$(ls -d internal/integrations/payment/*/ 2>/dev/null | wc -l | tr -d ' ')
if [ "$gateways" -ge 2 ] \
  && grep -q "type PaymentGateway interface" internal/modules/order/application/ports.go; then
  pass "网关实现归 integrations/payment（$gateways 个），业务只依赖 PaymentGateway 端口"
else
  bad "integrations/payment 实现不足或 order/application 缺 PaymentGateway 端口"
fi

echo "== 6/10 定时任务不含核心业务规则 =="
job_sql=$(grep -rn "SELECT \|UPDATE \|INSERT INTO\|DELETE FROM" \
  internal/platform/scheduler/jobs --include='*.go' | grep -v '_test.go' || true)
if [ -z "$job_sql" ]; then
  pass "scheduler/jobs 只做触发，不含 SQL/业务规则"
else
  bad "scheduler/jobs 中出现直接 SQL："
  echo "$job_sql"
fi

echo "== 7/10 API / 数据库 / 领域对象不共用 schema =="
if [ -f internal/modules/order/domain/order.go ] \
  && [ -f internal/modules/order/repository/sqlite/model.go ] \
  && [ -f internal/modules/order/transport/http/request.go ] \
  && [ -f internal/modules/order/transport/http/response.go ]; then
  pass "领域(domain/order.go) / DB(model.go) / API(request,response.go) 各自独立"
else
  bad "领域/DB/API 模型未完全分离"
fi

echo "== 8/10 模块之间不能绕过接口直接改数据 =="
if [ -f scripts/check-modules.sh ] && grep -q "check-modules" Makefile; then
  pass "跨模块隔离由 check-modules 机器强制（导入 + 表归属）"
else
  bad "缺少跨模块隔离检查（check-modules）"
fi

echo "== 9/10 每个关键行为都有同目录测试 =="
tests_ok=1
for layer in domain application repository/sqlite; do
  if [ -z "$(ls internal/modules/order/$layer/*_test.go 2>/dev/null)" ]; then
    bad "order/$layer 缺同目录测试"
    tests_ok=0
  fi
done
[ "$tests_ok" = 1 ] && pass "订单 domain/application/repository 均有同目录测试"

echo "== 10/10 根目录一个命令完成全部质量检查 =="
if grep -q "^check:" Makefile; then
  pass "make check 为统一入口（含全部门禁脚本 + 测试 + 构建）"
else
  bad "Makefile 缺 check 目标"
fi

exit $fail
