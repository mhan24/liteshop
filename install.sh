#!/usr/bin/env bash
# LiteShop 一键安装脚本
#
# 用法:
#   curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | DOMAIN=shop.example.com bash
#
# 环境变量:
#   DOMAIN        必填, 站点域名 (用于 Caddy 自动 HTTPS)
#   EMAIL         可选, Let's Encrypt 邮箱
#   BRANCH        可选, 默认 main
#   SKIP_SSL      可选, 1=跳过自动 HTTPS (纯 http, 调试用)
#
# 支持系统: Ubuntu 20.04+/22.04/24.04, Debian 11/12, CentOS 7+/Rocky/Alma 8/9 (x86_64/aarch64)

set -euo pipefail

# ---------- 输出与错误处理 ----------
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; NC='\033[0m'
info()  { echo -e "${GREEN}[+]${NC} $*"; }
warn()  { echo -e "${YELLOW}[!]${NC} $*"; }
fail()  { echo -e "${RED}[x]${NC} $*"; exit 1; }

DOMAIN="${DOMAIN:-}"
EMAIL="${EMAIL:-}"
BRANCH="${BRANCH:-main}"
SKIP_SSL="${SKIP_SSL:-0}"
SITE_SCHEME="https"
[ "$SKIP_SSL" = "1" ] && SITE_SCHEME="http"
# BUILD_ARTIFACT: 预构建产物 tgz (含 shop 二进制 + storefront/.output), 提供则跳过源码构建, 加速部署
BUILD_ARTIFACT="${BUILD_ARTIFACT:-}"
SRC_DIR="/opt/liteshop-src"
APP_DIR="/opt/cardshop"
SF_DIR="/opt/liteshop-storefront"
SHOP_USER="${SHOP_USER:-cardshop}"

[ -n "$DOMAIN" ] || fail "请设置 DOMAIN 环境变量, 例如: DOMAIN=shop.example.com"

# ---------- 系统检测 ----------
detect_os() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    OS="$ID"; OS_VERSION="$VERSION_ID"
  elif [ -f /etc/redhat-release ]; then
    OS="centos"
  else
    fail "无法识别系统, 仅支持 Ubuntu/Debian/CentOS/Rocky/Alma"
  fi
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64) GOARCH="amd64" ;;
    aarch64|arm64) GOARCH="arm64" ;;
    *) fail "不支持的架构: $ARCH" ;;
  esac
  info "系统: $OS $OS_VERSION ($GOARCH)"
}

pkg_install() {
  if command -v apt-get >/dev/null 2>&1; then
    export DEBIAN_FRONTEND=noninteractive
    apt-get update -y -qq
    apt-get install -y -qq "$@"
  elif command -v dnf >/dev/null 2>&1; then
    dnf install -y -q "$@"
  elif command -v yum >/dev/null 2>&1; then
    yum install -y -q "$@"
  else
    fail "无可用包管理器"
  fi
}

# ---------- 安装依赖 ----------
install_base() {
  info "安装基础依赖..."
  if command -v apt-get >/dev/null 2>&1; then
    pkg_install curl git ca-certificates tar unzip xz-utils build-essential sqlite3
  else
    pkg_install curl git ca-certificates tar unzip xz perl
  fi
}

install_go() {
  if command -v go >/dev/null 2>&1; then
    GOVER="$(go version | grep -oE 'go[0-9.]+' | tr -d 'go')"
    info "Go 已安装: $GOVER"
    return
  fi
  info "安装 Go 1.26..."
  local tarball="go1.26.5.linux-${GOARCH}.tar.gz"
  local url="https://go.dev/dl/${tarball}"
  curl -fsSL "$url" -o "/tmp/${tarball}"
  rm -rf /usr/local/go
  tar -C /usr/local -xzf "/tmp/${tarball}"
  rm -f "/tmp/${tarball}"
  export PATH="/usr/local/go/bin:$PATH"
  grep -q '/usr/local/go/bin' /etc/profile.d/go.sh 2>/dev/null || echo 'export PATH=$PATH:/usr/local/go/bin' > /etc/profile.d/go.sh
  info "Go $(go version) 已安装"
}

install_node() {
  if command -v node >/dev/null 2>&1; then
    info "Node 已安装: $(node -v)"
    return
  fi
  info "安装 Node.js 20..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
    pkg_install nodejs
  elif command -v dnf >/dev/null 2>&1 || command -v yum >/dev/null 2>&1; then
    curl -fsSL https://rpm.nodesource.com/setup_20.x | bash -
    pkg_install nodejs
  fi
  command -v node >/dev/null 2>&1 || fail "Node 安装失败"
  info "Node $(node -v) 已安装"
}

# ---------- 源码 ----------
fetch_source() {
  if [ -d "$SRC_DIR/.git" ]; then
    info "更新源码..."
    git -C "$SRC_DIR" fetch --quiet origin
    git -C "$SRC_DIR" checkout --quiet "$BRANCH"
    git -C "$SRC_DIR" pull --quiet --ff-only origin "$BRANCH" || true
  else
    info "克隆源码..."
    mkdir -p "$SRC_DIR"
    git clone --quiet --depth 1 --branch "$BRANCH" https://github.com/mhan24/liteshop.git "$SRC_DIR"
  fi
}

# ---------- 构建 ----------
build_app() {
  info "设置 npm 国内镜像(可选, 失败不影响)..."
  npm config set registry https://registry.npmmirror.com 2>/dev/null || true
  export GOFLAGS=-mod=mod
  export GOPROXY=https://goproxy.cn,direct

  info "构建后台 admin-ui..."
  cd "$SRC_DIR/admin-ui"
  npm install --no-audit --no-fund >/dev/null 2>&1 || npm install --no-audit --no-fund
  npm run build

  info "构建前台 storefront..."
  cd "$SRC_DIR/storefront"
  # 规避 npm optional 平台依赖 bug (oxc/rollup binding): 全新安装
  rm -f package-lock.json
  rm -rf node_modules
  npm install --no-audit --no-fund >/dev/null 2>&1 || true
  npm run build

  info "构建 Go 二进制..."
  cd "$SRC_DIR"
  CGO_ENABLED=0 go build -trimpath -o /tmp/shop ./cmd/shop
  info "构建完成"
}

# ---------- 安装目录与用户 ----------
setup_dirs() {
  info "创建运行目录与用户..."
  mkdir -p "$APP_DIR/data"
  id -u "$SHOP_USER" >/dev/null 2>&1 || useradd -r -s /usr/sbin/nologin "$SHOP_USER" 2>/dev/null || useradd -r -s /bin/false "$SHOP_USER"
  install -o "$SHOP_USER" -g "$SHOP_USER" -m 0755 /tmp/shop "$APP_DIR/shop"
  chown -R "$SHOP_USER:$SHOP_USER" "$APP_DIR"
  # 数据目录与数据库文件仅运行用户可读写
  chmod 700 "$APP_DIR/data"
  chmod 600 "$APP_DIR"/data/shop.db* 2>/dev/null || true

  # 前台产物 → /opt/liteshop-storefront, 复制 public 到 chunks
  rm -rf "$SF_DIR"
  mkdir -p "$SF_DIR"
  cp -r "$SRC_DIR/storefront/.output/." "$SF_DIR/"
  mkdir -p "$SF_DIR/server/chunks/public"
  cp -r "$SF_DIR/public/." "$SF_DIR/server/chunks/public/" 2>/dev/null || true
  chown -R root:root "$SF_DIR"
}

# ---------- systemd ----------
setup_systemd() {
  info "配置 systemd 服务..."
  cat > /etc/systemd/system/cardshop.service <<'EOF'
[Unit]
Description=Card Shop (LiteShop API)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=cardshop
Group=cardshop
UMask=0077
WorkingDirectory=/opt/cardshop
ExecStart=/opt/cardshop/shop
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  cat > /etc/systemd/system/liteshop-storefront.service <<'EOF'
[Unit]
Description=LiteShop Storefront (Nuxt SSR)
After=network-online.target cardshop.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/liteshop-storefront
ExecStart=/usr/bin/node /opt/liteshop-storefront/server/index.mjs
UMask=0077
Environment=NODE_ENV=production
Environment=PORT=3001
Restart=always
RestartSec=2

[Install]
WantedBy=multi-user.target
EOF

  systemctl daemon-reload
  systemctl enable cardshop liteshop-storefront 2>/dev/null || true
}

# ---------- Caddy ----------
install_caddy() {
  if command -v caddy >/dev/null 2>&1; then
    info "Caddy 已安装: $(caddy version)"
    return
  fi
  info "安装 Caddy..."
  if command -v apt-get >/dev/null 2>&1; then
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg 2>/dev/null || true
    curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list 2>/dev/null || true
    apt-get update -y -qq 2>/dev/null || true
    apt-get install -y -qq caddy 2>/dev/null || true
  fi
  if ! command -v caddy >/dev/null 2>&1; then
    warn "Caddy 仓库安装失败, 回退到二进制安装..."
    curl -fsSL "https://caddyserver.com/api/download?os=linux&arch=${GOARCH}" -o /tmp/caddy
    chmod +x /tmp/caddy
    install -m 0755 /tmp/caddy /usr/bin/caddy
    useradd -r -d /etc/caddy -s /usr/sbin/nologin caddy 2>/dev/null || true
    mkdir -p /var/log/caddy /etc/caddy /var/lib/caddy
  fi
  command -v caddy >/dev/null 2>&1 || fail "Caddy 安装失败"
}

write_caddyfile() {
  info "写入 Caddyfile..."
  if [ "$SKIP_SSL" = "1" ]; then
    ADDR="http://${DOMAIN}"
  else
    ADDR="${DOMAIN}"
  fi
  cat > /etc/caddy/Caddyfile <<EOF
${ADDR} {
	encode zstd gzip

	@backend path /api /api/* /notify /notify/* /admin /admin/* /health
	reverse_proxy @backend 127.0.0.1:8080

	header /_nuxt/* Cache-Control "public, max-age=31536000, immutable"
	header /assets/* Cache-Control "public, max-age=31536000, immutable"
	header /admin/assets/* Cache-Control "public, max-age=31536000, immutable"
	header /robots.txt Cache-Control "public, max-age=3600"
	header /sitemap.xml Cache-Control "public, max-age=3600"
	header /favicon.svg Cache-Control "public, max-age=86400"

	@dynamic path / /api/* /notify/* /admin/* /order* /product* /page* /setup /health
	header @dynamic Cache-Control "no-store"
	header @dynamic X-Robots-Tag "noindex, nofollow"

	# 前台（storefront）CSP：后台 /admin 的 CSP 由 Go 应用下发。
	@storefront not path /api* /notify* /admin* /health
	# unsafe-inline：Nuxt 内联引导脚本；unsafe-eval：vue-i18n 运行时消息编译（与后台 CSP 一致）
	header @storefront Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'"

	header {
		-Server
		Strict-Transport-Security "max-age=31536000"
		X-Content-Type-Options "nosniff"
		X-Frame-Options "DENY"
		Referrer-Policy "strict-origin-when-cross-origin"
		Permissions-Policy "geolocation=(), microphone=(), camera=()"
	}

	reverse_proxy 127.0.0.1:3001
}
EOF
  systemctl restart caddy 2>/dev/null || systemctl enable --now caddy 2>/dev/null || true
}

# ---------- 主流程 ----------
main() {
  detect_os
  install_base
  install_caddy

  if [ -n "$BUILD_ARTIFACT" ]; then
    info "使用预构建产物: $BUILD_ARTIFACT"
    if [ ! -f "$BUILD_ARTIFACT" ]; then
      curl -fsSL "$BUILD_ARTIFACT" -o /tmp/liteshop-release.tgz
      BUILD_ARTIFACT=/tmp/liteshop-release.tgz
    fi
    mkdir -p /tmp/liteshop-artifact
    tar -xzf "$BUILD_ARTIFACT" -C /tmp/liteshop-artifact
    install -m 0755 /tmp/liteshop-artifact/shop /tmp/shop
    rm -rf "$SRC_DIR"
    mkdir -p "$SRC_DIR/storefront"
    cp -r /tmp/liteshop-artifact/storefront/.output "$SRC_DIR/storefront/.output" 2>/dev/null || true
    if [ ! -f /tmp/shop ] || [ ! -d "$SRC_DIR/storefront/.output" ]; then
      fail "预构建产物缺少 shop 或 storefront/.output"
    fi
  else
    install_go
    install_node
    fetch_source
    build_app
  fi

  setup_dirs
  setup_systemd
  write_caddyfile

  info "启动服务..."
  systemctl restart cardshop
  sleep 2
  systemctl restart liteshop-storefront
  sleep 3

  systemctl is-active cardshop >/dev/null 2>&1 || fail "cardshop 启动失败, 请查看: journalctl -u cardshop -n 50"
  systemctl is-active liteshop-storefront >/dev/null 2>&1 || fail "storefront 启动失败, 请查看: journalctl -u liteshop-storefront -n 50"
  systemctl is-active caddy >/dev/null 2>&1 || fail "caddy 启动失败, 请查看: journalctl -u caddy -n 50"

  echo
  echo -e "${GREEN}==============================================${NC}"
  echo -e "${GREEN}  LiteShop 安装完成!${NC}"
  echo
  echo "  前台:      https://${DOMAIN}"
  echo "  后台登录:  https://${DOMAIN}/admin/login"
  echo "  首次配置:  打开后台或 https://${DOMAIN}/setup 完成初始化"
  echo
  echo "  服务管理:"
  echo "    systemctl status cardshop          # 后端 API"
  echo "    systemctl status liteshop-storefront # 前台 SSR"
  echo "    systemctl status caddy             # 反向代理/SSL"
  echo
  echo "  数据目录:  /opt/cardshop/data/shop.db"
  echo "  源码目录:  ${SRC_DIR}"
  echo -e "${GREEN}==============================================${NC}"
}

main "$@"
