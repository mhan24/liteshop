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

# ── 打包：用 git archive 而非 tar ───────────────────────────────────────────
#
# 为什么不用 tar：
#   macOS 的 tar（bsdtar）会把扩展属性写成 AppleDouble 条目，并且**在自己的
#   列表里隐藏它们**（tar tzf 看不到），但 Linux 的 GNU tar 会把它们全部
#   物化成 ._xxx 文件。结果是生产目录里混入上百个未入库的垃圾文件，
#   服务端与仓库不再一致（曾出现 190 个 ._ 文件）。
#   --no-xattrs 并不足以阻止这一行为。
#
# git archive 的好处：
#   - 只包含**已追踪**文件 → 服务端严格等于某个提交
#   - 完全不带 macOS 扩展属性
#   - 与「先推 GitHub、再部署」的流程天然一致
if ! git rev-parse --git-dir >/dev/null 2>&1; then
  echo "✗ 当前目录不是 git 仓库；deploy.sh 依赖 git archive 保证与提交一致" >&2
  exit 1
fi

DEPLOY_SHA="$(git rev-parse HEAD)"
DEPLOY_SHA_SHORT="$(git rev-parse --short HEAD)"

if [[ -n "$(git status --porcelain)" ]]; then
  echo "⚠ 工作区有未提交改动；将只部署已提交的 ${DEPLOY_SHA_SHORT}" >&2
fi

# 与远端比对：部署未推送的提交会造成「线上领先于 GitHub」，难以追溯
if git rev-parse --verify -q origin/main >/dev/null 2>&1; then
  if ! git merge-base --is-ancestor HEAD origin/main 2>/dev/null; then
    echo "⚠ HEAD (${DEPLOY_SHA_SHORT}) 尚未推送到 origin/main" >&2
    echo "  建议先 git push，再部署；继续将以本地提交部署。" >&2
  fi
fi

TARBALL="$(mktemp -t liteshop-deploy-XXXXXX.tar.gz)"
trap 'rm -f "$TARBALL"' EXIT
git archive --format=tar.gz -o "$TARBALL" HEAD

# 防御性检查：归档中不得出现 AppleDouble 条目
if tar tzf "$TARBALL" | grep -qE '(^|/)\._'; then
  echo "✗ 归档中检测到 AppleDouble 条目，中止部署" >&2
  exit 1
fi

TARBALL_SIZE="$(du -h "$TARBALL" | cut -f1)"
echo "→ 部署提交 ${DEPLOY_SHA_SHORT} (${TARBALL_SIZE}) 到 ${TARGET}:${REMOTE_DIR}"
if [[ "$DRY_RUN" == true ]]; then
  tar tzf "$TARBALL" | head -20
  echo "(dry-run：未实际部署，共 $(tar tzf "$TARBALL" | wc -l | tr -d ' ') 个条目)"
  exit 0
fi

# 上传前检查归档内容：不得包含任何生产密钥文件
if tar tzf "$TARBALL" | grep -qE '(^|/)\.env$|(^|/)\.deploy\.env$'; then
  echo "✗ 归档中包含生产密钥文件，中止部署" >&2
  exit 1
fi

ENV_HASH_BEFORE="$("${SSH[@]}" "$TARGET" "sha256sum $REMOTE_DIR/.env | cut -d' ' -f1")"

"${SCP[@]}" "$TARBALL" "$TARGET:/tmp/liteshop-deploy.tar.gz"

"${SSH[@]}" "$TARGET" bash -s <<EOF
set -euo pipefail

REMOTE_DIR="$REMOTE_DIR"
STAGING="\$(mktemp -d /tmp/liteshop-release-XXXXXX)"
trap 'rm -rf "\$STAGING"' EXIT

# ── 1. 解包到全新 staging 目录（不原地覆盖）────────────────────────────────
#
# 为什么不在原地解压：tar 覆盖解压**不会删除**上一版本已移除的文件。
# 例如某路由已从仓库删除，服务器上仍留着旧文件，下一次 \`COPY . .\` 可能
# 把它重新编译进镜像，导致「线上有仓库里不存在的代码」。
# 改用全新目录后，目录内容严格等于该提交。
tar xzf /tmp/liteshop-deploy.tar.gz -C "\$STAGING"
rm -f /tmp/liteshop-deploy.tar.gz

# 防御：staging 中不得出现 AppleDouble 或密钥文件
if find "\$STAGING" -name '._*' -type f | head -1 | grep -q .; then
  echo "✗ staging 中发现 AppleDouble 文件，中止" >&2; exit 1
fi
if [ -e "\$STAGING/.env" ] || [ -e "\$STAGING/.deploy.env" ]; then
  echo "✗ staging 中发现密钥文件，中止" >&2; exit 1
fi

# ── 2. 保留生产侧不入库的内容，再同步到目标目录 ─────────────────────────────
cd "\$REMOTE_DIR"

# 备份生产 .env（其内容不来自仓库，绝不能被覆盖）
ENV_BACKUP="\$(mktemp)"
cp .env "\$ENV_BACKUP"

# 记录将被移除的旧文件（同步后不存在于新版本者）
if command -v rsync >/dev/null 2>&1; then
  # --delete 保证目标目录严格等于 staging（即该提交）
  rsync -a --delete --exclude '.env' --exclude '.deploy.env' \
        --exclude 'data' --exclude 'node_modules' --exclude '.next' \
        --exclude '.git' --exclude 'backups' \
        "\$STAGING"/ "\$REMOTE_DIR"/
else
  echo "✗ 目标机缺少 rsync（apt-get install rsync），中止以避免目录残留" >&2
  exit 1
fi

# 恢复 .env 并校验指纹
cp "\$ENV_BACKUP" .env
rm -f "\$ENV_BACKUP"
NEW_ENV_HASH="\$(sha256sum .env | cut -d' ' -f1)"
if [ "\$NEW_ENV_HASH" != "$ENV_HASH_BEFORE" ]; then
  echo "✗ .env 指纹异常，中止部署" >&2
  exit 1
fi
echo "✓ .env 未被改动"

# ── 3. 构建并等待健康 ─────────────────────────────────────────────────────
rm -f /tmp/liteshop-deploy.tar.gz
if ! docker compose $COMPOSE_FILES up -d --build --wait --wait-timeout 180; then
  echo "✗ 构建或健康检查失败；容器保持现状，请检查日志：" >&2
  docker compose $COMPOSE_FILES logs --tail 60 liteshop >&2 || true
  exit 1
fi
docker compose $COMPOSE_FILES ps

# ── 4. 健康通过后才落盘部署标记 ───────────────────────────────────────────
echo "$DEPLOY_SHA" > .deployed-commit
echo "✓ 部署标记已写入：$DEPLOY_SHA"
EOF

echo "✓ 部署完成 (${DEPLOY_SHA_SHORT})：https://${DOMAIN:-$SSH_HOST}"
