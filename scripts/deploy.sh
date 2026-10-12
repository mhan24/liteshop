#!/usr/bin/env bash
#
# 部署脚本：把当前工作区同步到服务器并重建容器。
#
# ⚠️ 这是**上线操作**，会直接影响正在服务真实交易的生产环境。
#    按项目约定，代码改动应先只推送 GitHub，等用户明确下达部署指令后才运行本脚本。
#
# 凭证与运行时配置分离：
#   - .env        应用运行时配置（会被 docker compose 读取）
#   - .deploy.env 仅本脚本读取的 SSH 凭证（不进容器、不参与 compose）
#
# 用法：
#   ./scripts/deploy.sh --dry-run   # 预览（不做任何改动，无需确认）
#   ./scripts/deploy.sh --yes       # 直接部署（用于已获授权的自动化）
#   ./scripts/deploy.sh             # 交互确认后部署
#
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

DRY_RUN=false
ASSUME_YES=false
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=true ;;
    --yes|-y)  ASSUME_YES=true ;;
    *) echo "未知参数: $arg" >&2; exit 2 ;;
  esac
done

# 非 dry-run 且未显式 --yes 时要求交互确认，避免误触上线
if [[ "$DRY_RUN" != true && "$ASSUME_YES" != true ]]; then
  if [[ ! -t 0 ]]; then
    echo "✗ 非交互环境：请显式传入 --yes 以确认部署" >&2
    exit 1
  fi
  echo "即将部署到生产环境（$ROOT → 服务器）。"
  read -r -p "确认部署？输入 yes 继续：" reply
  [[ "$reply" == "yes" ]] || { echo "已取消"; exit 0; }
fi

DEPLOY_ENV="$ROOT/.deploy.env"
if [[ ! -f "$DEPLOY_ENV" ]]; then
  echo "缺少 $DEPLOY_ENV（参考 .deploy.env.example）" >&2
  exit 1
fi
# shellcheck disable=SC1090
set -a; source "$DEPLOY_ENV"; set +a

: "${SSH_HOST:?SSH_HOST 未设置}"
: "${SSH_PORT:=22}"
: "${SSH_USER:?SSH_USER 未设置}"
: "${REMOTE_DIR:=/opt/liteshop}"
: "${COMPOSE_FILES:=-f docker-compose.yml -f docker-compose.caddy.yml}"

SSH_OPTS=(-o StrictHostKeyChecking=accept-new -p "$SSH_PORT")

# 密码认证：有 sshpass 时走密码；否则走密钥（推荐）
if [[ -n "${SSH_PASSWORD:-}" ]]; then
  command -v sshpass >/dev/null || { echo "需要 sshpass（brew install sshpass）或改用密钥登录" >&2; exit 1; }
  SSH=(sshpass -e ssh "${SSH_OPTS[@]}")
  SCP=(sshpass -e scp -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
  export SSHPASS="$SSH_PASSWORD"
else
  SSH=(ssh "${SSH_OPTS[@]}")
  SCP=(scp -P "$SSH_PORT" -o StrictHostKeyChecking=accept-new)
fi

TARGET="$SSH_USER@$SSH_HOST"

# 打包源码（排除本地/构建/运行时产物与凭证）
TARBALL="$(mktemp -t liteshop-deploy-XXXXXX.tar.gz)"
trap 'rm -f "$TARBALL"' EXIT

tar czf "$TARBALL" --no-xattrs \
  --exclude=node_modules --exclude=.next --exclude=data --exclude=.git \
  --exclude='*.tsbuildinfo' --exclude='.env*' --exclude='.deploy.env' \
  src drizzle public scripts \
  package.json package-lock.json next.config.ts tsconfig.json \
  drizzle.config.ts eslint.config.mjs vitest.config.ts components.json \
  Dockerfile docker-compose.yml docker-compose.caddy.yml Caddyfile \
  README.md PLAN.md AGENTS.md

echo "→ 上传 $(du -h "$TARBALL" | cut -f1) 到 $TARGET:$REMOTE_DIR"
if [[ "${1:-}" == "--dry-run" ]]; then
  tar tzf "$TARBALL" | head -20
  echo "(dry-run：未实际部署)"
  exit 0
fi

"${SCP[@]}" "$TARBALL" "$TARGET:/tmp/liteshop-deploy.tar.gz"

"${SSH[@]}" "$TARGET" bash -s <<EOF
set -euo pipefail
cd "$REMOTE_DIR"
# 部署前先校验 .env 指纹，确保解包不会覆盖应用配置
BEFORE=\$(sha256sum .env | cut -d' ' -f1)
tar xzf /tmp/liteshop-deploy.tar.gz -C "$REMOTE_DIR"
AFTER=\$(sha256sum .env | cut -d' ' -f1)
if [ "\$BEFORE" != "\$AFTER" ]; then
  echo "✗ .env 被意外修改，中止部署" >&2
  exit 1
fi
echo "✓ .env 未被改动"
rm -f /tmp/liteshop-deploy.tar.gz
docker compose $COMPOSE_FILES up -d --build
docker compose $COMPOSE_FILES ps
EOF

echo "✓ 部署完成：https://${DOMAIN:-$SSH_HOST}"
