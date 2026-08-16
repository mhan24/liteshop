#!/usr/bin/env bash
# 安全门禁：密钥泄露与危险配置扫描（不依赖外部扫描器，可在本地与 CI 直接运行）。
set -euo pipefail
cd "$(dirname "$0")/.."

fail=0

echo "== 1/4 密钥泄露扫描 =="
# 已跟踪及待提交文件中不得出现真实私钥块或平台令牌明文（排除锁文件/校验和文件）。
secret_hits=0
while IFS= read -r -d '' file; do
  case "$file" in
    *.lock|*.sum) continue ;;
  esac
  if grep -lE -- \
      '-----BEGIN (RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[[:space:]]*$|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{24,}|xox[baprs]-[A-Za-z0-9-]{10,}' \
      "$file" 2>/dev/null; then
    secret_hits=1
  fi
done < <(git ls-files --cached --others --exclude-standard -z)
if [ "$secret_hits" -ne 0 ]; then
  echo "!! 检测到疑似密钥/令牌明文（见上方文件）"
  fail=1
else
  echo "OK 未发现疑似明文密钥/令牌"
fi

echo "== 2/4 危险配置：.env 不得入库 =="
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "!! .env 被纳入版本控制，应加入 .gitignore 并移除跟踪"
  fail=1
else
  echo "OK .env 未被跟踪"
fi

echo "== 3/4 危险配置：session_secret 不得硬编码 =="
if git grep -nE 'session_secret\s*[:=]\s*["'"'"'][^"'"'"']+' -- '*.go' ':!**/*_test.go' 2>/dev/null; then
  echo "!! 检测到硬编码 session_secret（见上方位置）"
  fail=1
else
  echo "OK 未发现硬编码 session_secret"
fi

echo "== 4/4 危险配置：安全响应头必须就位 =="
if ! grep -q 'X-Frame-Options' internal/app/server.go \
  || ! grep -q 'Content-Security-Policy' internal/app/server.go \
  || ! grep -q 'X-Content-Type-Options' internal/app/server.go; then
  echo "!! internal/app/server.go 缺少安全响应头（nosniff / X-Frame-Options / CSP）"
  fail=1
else
  echo "OK 安全响应头就位"
fi

exit $fail
