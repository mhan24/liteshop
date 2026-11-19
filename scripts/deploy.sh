#!/usr/bin/env bash
#
# 生产部署：拉取 CI 构建好的镜像（ghcr.io，标签 = 提交号）→ 服务器滚动更新。
#
# 约定（见 AGENTS.md）：
# - 每次部署都必须是用户当次的显式指令；
# - 服务器 .env 是生产配置（含真实网关凭证），脚本从不上传它，并在部署前后校验 sha256 指纹；
# - 镜像只由 CI 在测试全部通过后构建（.github/workflows/ci.yml 的 image 任务），本机不需要 Docker。
#
# 用法：
#   scripts/deploy.sh            # 部署 origin/main 当前提交
#   scripts/deploy.sh <提交号>    # 部署指定提交（回滚也用它）
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_ENV_FILE=".deploy.env"
[ -f "$DEPLOY_ENV_FILE" ] || { echo "✗ 缺少 ${DEPLOY_ENV_FILE}（参照 .deploy.env.example）"; exit 1; }
# shellcheck disable=SC1090
source "$DEPLOY_ENV_FILE"

SSH_HOST="${SSH_HOST:?SSH_HOST 未配置}"
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/liteshop}"
SITE_URL="${SITE_URL:-https://shop.9527.tr}"
REPO="${IMAGE_REPO:-ghcr.io/mhan24/liteshop}"
SSH_OPTS=(-p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)

run_remote() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }
copy_remote() { scp -q -P "$SSH_PORT" -o BatchMode=yes -o ConnectTimeout=15 -r "$1" "$SSH_USER@$SSH_HOST:$2"; }

# ---- 1. 确定要部署的提交，并确认 CI 已为它构建镜像 ----
git fetch -q origin main
SHA="$(git rev-parse "${1:-origin/main}")"
IMAGE="$REPO:$SHA"
echo "▶ 部署提交 ${SHA:0:12}（$(git log -1 --format=%s "$SHA")）"

if ! git merge-base --is-ancestor "$SHA" origin/main; then
  echo "✗ 该提交不在 origin/main 上（未推送或不属于主分支），CI 不会为它构建镜像"
  exit 1
fi
if [ -n "$(git status --porcelain)" ] && [ -z "${1:-}" ]; then
  echo "  注意：本地有未提交改动，它们不会被部署（部署的是 origin/main 上的提交）"
fi

echo "▶ 确认镜像已构建：$IMAGE"
TOKEN="$(curl -fsS "https://ghcr.io/token?scope=repository:${REPO#ghcr.io/}:pull" | sed -E 's/.*"token":"([^"]+)".*/\1/')"
if ! curl -fsS -o /dev/null -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.oci.image.index.v1+json, application/vnd.docker.distribution.manifest.v2+json" \
  "https://ghcr.io/v2/${REPO#ghcr.io/}/manifests/$SHA"; then
  echo "✗ 镜像不存在。CI 可能还在运行或失败了：gh run list --commit $SHA"
  exit 1
fi

# ---- 2. 服务器前置检查 ----
echo "▶ 记录服务器 .env 指纹（部署过程不得改变它）"
ENV_BEFORE="$(run_remote "sha256sum $REMOTE_DIR/.env" | awk '{print $1}')"
echo "  ${ENV_BEFORE:0:16}"

echo "▶ 校验 Caddy 域名（DOMAIN 必须与 SITE_URL 一致）"
SITE_HOST="$(printf '%s' "$SITE_URL" | sed -E 's#^https?://##; s#[/:].*$##')"
REMOTE_DOMAIN="$(run_remote "sed -n 's/^DOMAIN=//p' $REMOTE_DIR/.env | tail -n 1" | tr -d "\r\"' ")"
if [ "$REMOTE_DOMAIN" != "$SITE_HOST" ]; then
  echo "✗ 服务器 .env 的 DOMAIN（${REMOTE_DOMAIN:-未设置}）与 SITE_URL 域名（${SITE_HOST}）不一致"
  exit 1
fi

# ---- 3. 准备新编排（先放到暂存目录校验，校验通过才替换） ----
echo "▶ 上传编排文件到暂存目录并校验"
STAGE="/tmp/liteshop-deploy-$SHA"
run_remote "rm -rf $STAGE && mkdir -p $STAGE"
for f in docker-compose.yml Caddyfile ops; do
  git archive "$SHA" "$f" | run_remote "tar -x -C $STAGE"
done
run_remote "docker compose --project-directory $REMOTE_DIR -f $STAGE/docker-compose.yml config -q"

# ---- 4. 备份 + 拉镜像（此时线上服务未受影响） ----
echo "▶ 部署前备份数据库"
run_remote "set -e; cd $REMOTE_DIR
  ts=\$(date +%Y%m%d-%H%M%S)
  docker compose exec -T db pg_dump -U liteshop -d liteshop -F c > backups/pre-deploy-\$ts.dump
  docker compose exec -T db pg_restore -l < backups/pre-deploy-\$ts.dump > /dev/null
  echo \"  backups/pre-deploy-\$ts.dump\""

echo "▶ 服务器拉取镜像"
run_remote "docker pull -q $IMAGE"

# ---- 5. 切换 ----
echo "▶ 切换：保留旧镜像为 liteshop:previous → 更新编排 → 滚动更新"
run_remote "set -e; cd $REMOTE_DIR
  docker image inspect liteshop:latest >/dev/null 2>&1 && docker tag liteshop:latest liteshop:previous
  docker tag $IMAGE liteshop:latest
  ts=\$(date +%Y%m%d-%H%M%S)
  cp docker-compose.yml backups/docker-compose.yml.pre-\$ts
  cp Caddyfile backups/Caddyfile.pre-\$ts
  rm -rf ops && cp -r $STAGE/ops ops && cp $STAGE/docker-compose.yml $STAGE/Caddyfile .
  echo $SHA > DEPLOYED_REVISION
  docker compose up -d --no-build --remove-orphans
  rm -rf $STAGE
  docker image prune -f >/dev/null"

# ---- 6. 验证 ----
echo "▶ 等待应用容器 healthy"
if ! run_remote "cd $REMOTE_DIR && docker compose ps app | grep -F '(healthy)' >/dev/null"; then
  echo "✗ 应用容器未达 healthy。回滚：scripts/deploy.sh <上一个提交号>"
  echo "  或在服务器执行：docker tag liteshop:previous liteshop:latest && cd $REMOTE_DIR && docker compose up -d --no-build"
  exit 1
fi
echo "  app (healthy)"

echo "▶ 复核 .env 指纹"
ENV_AFTER="$(run_remote "sha256sum $REMOTE_DIR/.env" | awk '{print $1}')"
if [ "$ENV_BEFORE" != "$ENV_AFTER" ]; then
  echo "✗ 服务器 .env 在部署过程中被修改（${ENV_BEFORE:0:16} → ${ENV_AFTER:0:16}），请立即检查！"
  exit 1
fi
echo "  一致"

echo "▶ 外部可达性检查 $SITE_URL"
curl -fsS "$SITE_URL/api/health" >/dev/null && echo "✓ 部署完成：${SHA:0:12}"
