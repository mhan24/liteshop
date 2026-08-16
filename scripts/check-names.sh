#!/usr/bin/env bash
# 第十七条：文件命名规则。
# 1) 禁用通用命名（manager/helper/utils/common/misc/base/handler/handlers/service_impl）；
#    按行为命名（create.go / cancel.go / confirm_payment.go / routes.go / views.go …）。
# 2) 前端同样禁用通用命名；保留 shadcn 约定的 lib/utils.ts（cn() 工具）。
# 3) 第三方支付集成必须按角色拆分：client.go / dto.go / callback.go / signature.go / errors.go；
#    测试文件与源文件同名（如 client_test.go）。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== 1/3 Go 文件命名 =="
bad=$(find cmd internal tests -type f -name '*.go' \
  | grep -E '/(manager|helper|helpers|utils|util|common|misc|base|handler|handlers|service_impl)\.go$' || true)
if [ -n "$bad" ]; then
  echo "!! 以下 Go 文件使用通用命名（应按行为/角色命名）："
  echo "$bad"
  fail=1
else
  echo "OK"
fi

echo "== 2/3 前端文件命名 =="
bad=$(find web -type f \( -name '*.ts' -o -name '*.vue' -o -name '*.tsx' \) \
  ! -path '*/node_modules/*' ! -path '*/.nuxt/*' ! -path '*/.output/*' ! -path '*/dist/*' \
  | grep -E '/(manager|helper|helpers|utils|util|common|misc|base|service_impl)\.(ts|vue|tsx)$' \
  | grep -v '/lib/utils\.ts$' || true)
if [ -n "$bad" ]; then
  echo "!! 以下前端文件使用通用命名："
  echo "$bad"
  fail=1
else
  echo "OK（lib/utils.ts 为 shadcn 约定，保留）"
fi

echo "== 3/3 第三方支付集成结构 =="
while IFS= read -r dir; do
  [ -z "$dir" ] && continue
  for required in client.go dto.go; do
    if [ ! -f "$dir/$required" ]; then
      echo "!! $dir 缺少 $required（第三方集成按角色拆分）"
      fail=1
    fi
  done
  # 回调型网关必须有回调或签名文件（按协议二选一或两者都有）。
  if [ ! -f "$dir/callback.go" ] && [ ! -f "$dir/signature.go" ]; then
    echo "!! $dir 缺少 callback.go 或 signature.go"
    fail=1
  fi
done < <(find internal/integrations/payment -mindepth 1 -maxdepth 1 -type d)
if [ "$fail" -eq 0 ]; then
  echo "OK"
fi

exit $fail
