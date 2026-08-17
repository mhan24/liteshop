#!/usr/bin/env bash
# 第二十条：现有目录 → 新目录的直接映射门禁。
# 校验旧结构的每一类代码都已落到新目录的目标位置，防止回退到
# api/、service/、schema/ 等全局大目录。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

check() {
  local desc="$1" path="$2"
  if [ -e "$path" ]; then
    echo "OK  $desc → $path"
  else
    echo "!!  $desc → 缺少 $path"
    fail=1
  fi
}

echo "== 订单模块映射 =="
check "api/order*.go"            "internal/modules/order/transport/http"
check "service/order*.go"        "internal/modules/order/application"
check "创建订单流程"              "internal/modules/order/application/create.go"
check "订单状态常量"              "internal/modules/order/domain/status.go"
check "订单状态转换"              "internal/modules/order/domain/transition.go"
check "订单 Repository 接口"      "internal/modules/order/application/ports.go"
check "订单 SQLite 实现"          "internal/modules/order/repository/sqlite/repository.go"
check "schema/order.go 业务字段"   "internal/modules/order/domain/order.go"
check "schema/order.go DB 字段"    "internal/modules/order/repository/sqlite/model.go"
check "schema/order.go 映射"       "internal/modules/order/repository/sqlite/mapper.go"
check "schema/order.go API 字段"   "internal/modules/order/transport/http/request.go"
check "schema/order.go API 响应"   "internal/modules/order/transport/http/response.go"

echo "== 集成与平台映射 =="
check "BEpusdt 实现"            "internal/integrations/payment/bepusdt"
check "SMTP 实现"               "internal/integrations/notification/smtp"
check "订单过期任务"             "internal/platform/scheduler/jobs/order_expire.go"
check "过期业务逻辑"             "internal/modules/order/application/expire.go"
check "SQLite 初始化"           "internal/platform/database/sqlite"
check "备份恢复"                "internal/platform/backup"
check "日志初始化"              "internal/platform/logging"

echo "== 禁止回退的旧目录 =="
for d in api service schema; do
  if [ -e "internal/$d" ]; then
    echo "!! 旧全局目录 internal/$d 不应存在（已按模块拆分）"
    fail=1
  fi
done

exit $fail
