#!/usr/bin/env bash
# 生成 LiteShop 预构建发布产物, 供 install.sh 使用 BUILD_ARTIFACT 快速部署
#
# 用法: bash build-release.sh [输出路径]
#   默认输出: /tmp/liteshop-release.tgz
#
# 产物结构:
#   shop                      # linux 二进制 (本机架构)
#   storefront/.output/       # Nuxt SSR 构建产物

set -euo pipefail
OUT="${1:-/tmp/liteshop-release.tgz}"
ROOT="$(cd "$(dirname "$0")" && pwd)"

echo "[+] 构建 admin-ui..."
cd "$ROOT/admin-ui"
npm install --no-audit --no-fund
npm run build

echo "[+] 构建 storefront..."
cd "$ROOT/storefront"
rm -f package-lock.json; rm -rf node_modules
npm install --no-audit --no-fund
npm run build

echo "[+] 构建 Go 二进制..."
cd "$ROOT"
ARCH="$(uname -m)"
case "$ARCH" in
  x86_64) GOOS=linux GOARCH=amd64 ;;
  aarch64|arm64) GOOS=linux GOARCH=arm64 ;;
  *) echo "不支持的架构: $ARCH" >&2; exit 1 ;;
esac
export GOOS GOARCH CGO_ENABLED=0 GOPROXY="${GOPROXY:-https://goproxy.cn,direct}"
VERSION="$(git describe --tags --always --dirty 2>/dev/null | sed 's/^v//' || echo 0.1.0)"
COMMIT="$(git rev-parse --short HEAD 2>/dev/null || true)"
DATE="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
go build -trimpath -ldflags "-X shop/internal/version.Version=${VERSION} -X shop/internal/version.Commit=${COMMIT} -X shop/internal/version.Date=${DATE}" -o /tmp/shop ./cmd/shop
echo "[+] 版本: v${VERSION} (${COMMIT}, ${DATE})"

echo "[+] 打包..."
STAGE="$(mktemp -d)"
mkdir -p "$STAGE/storefront"
cp /tmp/shop "$STAGE/shop"
cp -r "$ROOT/storefront/.output" "$STAGE/storefront/.output"
tar -czf "$OUT" -C "$STAGE" shop storefront
rm -rf "$STAGE" /tmp/shop

echo "[+] 发布产物已生成: $OUT"
echo "    部署: curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | DOMAIN=shop.example.com BUILD_ARTIFACT=$OUT bash"
