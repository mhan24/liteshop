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
#   HATOBA_HOST=ORACLE scripts/deploy.sh   # 经 Hatoba 执行远程命令（不用本机 SSH 密钥）
set -euo pipefail
cd "$(dirname "$0")/.."

DEPLOY_ENV_FILE=".deploy.env"
[ -f "$DEPLOY_ENV_FILE" ] || { echo "✗ 缺少 ${DEPLOY_ENV_FILE}（参照 .deploy.env.example）"; exit 1; }
# shellcheck disable=SC1090
source "$DEPLOY_ENV_FILE"

SSH_HOST="${SSH_HOST:-}"
[ -n "$SSH_HOST" ] || [ -n "${HATOBA_HOST:-}" ] || { echo "✗ 需配置 SSH_HOST 或 HATOBA_HOST"; exit 1; }
SSH_PORT="${SSH_PORT:-22}"
SSH_USER="${SSH_USER:-root}"
REMOTE_DIR="${REMOTE_DIR:-/opt/liteshop}"
SITE_URL="${SITE_URL:-https://shop.9527.tr}"
REPO="${IMAGE_REPO:-ghcr.io/mhan24/liteshop}"
SSH_OPTS=(-p "$SSH_PORT" -o BatchMode=yes -o StrictHostKeyChecking=accept-new -o ConnectTimeout=15)

# 远程执行通道：默认 SSH 密钥；设置 HATOBA_HOST（Hatoba 里保存的主机名）则改用 hatoba exec，
# 凭据留在 Hatoba 桌面端，不经过本脚本。例：HATOBA_HOST=ORACLE scripts/deploy.sh
if [ -n "${HATOBA_HOST:-}" ]; then
  command -v hatoba >/dev/null || { echo "✗ 找不到 hatoba 命令（需安装 Hatoba 并开启「在终端使用 hatoba 命令」）"; exit 1; }
  run_remote() { hatoba exec "$HATOBA_HOST" -- "$*"; }
  echo "▶ 远程通道：Hatoba（${HATOBA_HOST}）"
else
  run_remote() { ssh "${SSH_OPTS[@]}" "$SSH_USER@$SSH_HOST" "$@"; }
fi

# 在 SSH 和 Hatoba 下都通过 stdin 传脚本。路径作为参数独立引用，保留原始值。
remote_script() {
  local command="sh -s --" arg
  for arg do
    arg=$(printf '%s' "$arg" | sed "s~'~'\"'\"'~g")
    command+=" '$arg'"
  done
  run_remote "$command"
}

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
SITE_HOST="$(printf '%s' "$SITE_URL" | sed -E 's#^https?://##; s#[/:].*$##')"
echo "▶ 校验 Caddy 域名并记录服务器 .env 指纹"
ENV_BEFORE="$(remote_script "$REMOTE_DIR" "$SITE_HOST" <<'REMOTE'
set -eu
cd "$1"
domain=$(sed -n 's/^DOMAIN=//p' .env | tail -n 1 | tr -d "\r\"' ")
[ "$domain" = "$2" ] || { echo "服务器 DOMAIN 与 SITE_URL 域名不一致" >&2; exit 1; }
sha256sum .env | cut -d' ' -f1
REMOTE
)"
[[ "$ENV_BEFORE" =~ ^[a-f0-9]{64}$ ]] || { echo "无法读取服务器 .env 指纹" >&2; exit 1; }
echo "  ${ENV_BEFORE:0:16}"

# ---- 3. 校验提交中的编排文件 ----
STAGE="$(run_remote "mktemp -d /tmp/liteshop-deploy-$SHA.XXXXXX")"
[[ "$STAGE" =~ ^/tmp/liteshop-deploy-[a-f0-9]+\.[a-zA-Z0-9]+$ ]] || { echo "暂存目录无效" >&2; exit 1; }
trap 'run_remote "rm -rf $STAGE" >/dev/null || true' EXIT
git archive "$SHA" docker-compose.yml Caddyfile ops | run_remote "tar -x -C $STAGE"
remote_script "$REMOTE_DIR" "$STAGE" <<'REMOTE'
docker compose --project-directory "$1" -f "$2/docker-compose.yml" config -q
REMOTE

echo "▶ 服务器拉取镜像"
run_remote "docker pull -q $IMAGE"

# ---- 4. 备份与切换 ----
echo "▶ 部署前备份并等待新版本健康"
remote_script "$REMOTE_DIR" "$STAGE" "$REPO" "$SHA" "$ENV_BEFORE" <<'REMOTE'
set -eu
cd "$1"
stage=$2 repo=$3 sha=$4 env_before=$5
exec 9>.deploy.lock
flock -n 9 || { echo "另一项部署正在切换，请稍后重试" >&2; exit 1; }
test "$env_before" = "$(sha256sum .env | cut -d' ' -f1)"

# 在发布新 revision 之前始终保留上次验证通过的版本，失败后重试也能回滚。
if [ -s DEPLOYED_REVISION ]; then
  good=$(cat DEPLOYED_REVISION)
  if [ "$good" != "$sha" ]; then docker tag "$repo:$good" liteshop:previous; fi
elif ! docker image inspect liteshop:previous >/dev/null 2>&1; then
  current=$(docker compose ps -q app)
  if [ -n "$current" ] && [ "$(docker inspect -f '{{.State.Health.Status}}' "$current")" = healthy ]; then
    docker tag "$(docker inspect -f '{{.Image}}' "$current")" liteshop:previous
  fi
fi

mkdir -p backups
tmp=$(mktemp "backups/pre-deploy-$(date +%Y%m%d-%H%M%S).XXXXXX")
trap 'rm -f "$tmp"' EXIT
docker compose exec -T db pg_dump -U liteshop -d liteshop -F c > "$tmp"
docker compose exec -T db pg_restore -l < "$tmp" > /dev/null
ln "$tmp" "$tmp.dump"
echo "  $tmp.dump"
suffix=${tmp#backups/pre-deploy-}
cp docker-compose.yml "backups/docker-compose.yml.pre-$suffix"
cp Caddyfile "backups/Caddyfile.pre-$suffix"

for service in backup offsite; do
  if [ -f "ops/$service.sh" ] && [ -f "$stage/ops/$service.sh" ] && ! cmp -s "ops/$service.sh" "$stage/ops/$service.sh"; then
    docker compose ps -q "$service" > "$stage/$service.old"
  fi
done
echo "$stage" > .deploy-attempt
docker tag "$repo:$sha" liteshop:latest
mkdir -p ops
cp -R "$stage/ops/." ops/
cp "$stage/docker-compose.yml" "$stage/Caddyfile" .
docker compose up -d --no-build --remove-orphans --wait --wait-timeout 180
# Compose 看不到绑定目录中文件的变化。仅重启仍为旧实例的脚本服务。
for service in backup offsite; do
  if [ -s "$stage/$service.old" ] && [ "$(cat "$stage/$service.old")" = "$(docker compose ps -q "$service")" ]; then
    docker compose restart "$service"
  fi
done
REMOTE

# ---- 5. 外部验收和确认 ----
echo "▶ 从部署端验证 $SITE_URL"
curl -fsS --max-time 15 "$SITE_URL/api/health" >/dev/null
remote_script "$REMOTE_DIR" "$STAGE" "$SHA" "$ENV_BEFORE" <<'REMOTE'
set -eu
cd "$1"
exec 9>.deploy.lock
flock -n 9 || { echo "另一项部署正在切换，本次验收已失效" >&2; exit 1; }
[ "$(cat .deploy-attempt)" = "$2" ] || { echo "部署版本已被替换，本次验收已失效" >&2; exit 1; }
[ "$4" = "$(sha256sum .env | cut -d' ' -f1)" ] || { echo "部署期间 .env 指纹发生变化" >&2; exit 1; }
echo "$3" > DEPLOYED_REVISION.tmp
mv DEPLOYED_REVISION.tmp DEPLOYED_REVISION
rm -f .deploy-attempt
REMOTE
echo "✓ 部署完成：${SHA:0:12}"
