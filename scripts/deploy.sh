#!/usr/bin/env bash
#
# 生产部署：本地构建 arm64 镜像 → 上传 → 服务器加载 → compose 滚动更新。
#
# 约定（见 AGENTS.md）：
# - 每次部署都必须是用户当次的显式指令，脚本只做部署这一件事；
# - 服务器 /opt/liteshop/.env 是生产配置（含真实网关凭证），脚本**从不上传**它，
#   并在部署前后校验其 sha256 指纹，一旦变化立即报错终止；
# - 回滚：服务器上保留上一版镜像为 liteshop:previous，
#   手动执行 `docker tag liteshop:previous liteshop:latest && docker compose up -d` 即可。
#
# 用法：scripts/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_ENV_FILE=".deploy.env"
[ -f "$DEPLOY_ENV_FILE" ] || { echo "✗ 缺少 $DEPLOY_ENV_FILE（参照 .deploy.env.example）"; exit 1; }
# shellcheck disable=SC1090
source "$DEPLOY_ENV_FILE"

SSH_HOST="${SSH_HOST:?SSH_HOST 未配置}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/liteshop}"
SSH_OPTS=(-o StrictHostKeyChecking=accept-new -o ConnectTimeout=15 -p "$SSH_PORT")

run_remote() { sshpass -f "$DEPLOY_ENV_FILE" ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }
copy_remote() { sshpass -f "$DEPLOY_ENV_FILE" scp "${SSH_OPTS[@]}" "$1" "$SSH_USER@$SSH_HOST:$2"; }

SITE_URL="${SITE_URL:-https://shop.9527.tr}"
IMAGE="liteshop:latest"
echo "▶ 部署目标 $SSH_USER@$SSH_HOST:$REMOTE_DIR（SITE_URL=$SITE_URL）"

echo "▶ 校验本地环境（镜像构建在本地完成，服务器不执行 npm/docker build）"
[ -f docker-compose.yml ] || { echo "✗ 缺少 docker-compose.yml"; exit 1; }
[ -f Caddyfile ] || { echo "✗ 缺少 Caddyfile"; exit 1; }

echo "▶ 记录服务器 .env 指纹（部署过程不得改变它）"
ENV_BEFORE="$(run_remote "sha256sum $REMOTE_DIR/.env" | awk '{print $1}')"
echo "  $ENV_BEFORE"

echo "▶ 本地构建镜像 $IMAGE"
docker build --platform linux/arm64 --build-arg "SITE_URL=$SITE_URL" -t "$IMAGE" .

TARBALL="$(mktemp -d)/liteshop-image.tar.gz"
echo "▶ 导出镜像"
docker save "$IMAGE" | gzip > "$TARBALL"

echo "▶ 上传镜像与编排文件"
copy_remote "$TARBALL" "/tmp/liteshop-image.tar.gz"
copy_remote docker-compose.yml "$REMOTE_DIR/docker-compose.yml"
copy_remote Caddyfile "$REMOTE_DIR/Caddyfile"

echo "▶ 服务器：备份当前镜像 → 加载新镜像 → 滚动更新"
run_remote "set -e
  docker image inspect liteshop:previous >/dev/null 2>&1 && docker rmi liteshop:previous || true
  docker tag $IMAGE liteshop:previous
  gunzip -c /tmp/liteshop-image.tar.gz | docker load
  rm -f /tmp/liteshop-image.tar.gz
  cd $REMOTE_DIR
  docker compose up -d --no-build --remove-orphans
  docker image prune -f >/dev/null"

echo "▶ 等待应用健康检查"
for i in $(seq 1 30); do
  if run_remote "curl -fsS http://localhost:3000/api/health >/dev/null 2>&1"; then
    echo "  应用健康（第 ${i} 次探测）"
    break
  fi
  [ "$i" = 30 ] && { echo "✗ 健康检查超时，回滚请执行：docker tag liteshop:previous liteshop:latest && cd $REMOTE_DIR && docker compose up -d --no-build"; exit 1; }
  sleep 2
done

echo "▶ 复核 .env 指纹"
ENV_AFTER="$(run_remote "sha256sum $REMOTE_DIR/.env" | awk '{print $1}')"
if [ "$ENV_BEFORE" != "$ENV_AFTER" ]; then
  echo "✗ 服务器 .env 在部署过程中被修改（$ENV_BEFORE → $ENV_AFTER），请立即检查！"
  exit 1
fi
echo "  一致：$ENV_AFTER"

echo "▶ 外部可达性检查 $SITE_URL"
curl -fsS "$SITE_URL/api/health" >/dev/null && echo "✓ https 入口正常"

echo "✓ 部署完成"
