# ===== 构建阶段 =====
FROM node:20-alpine AS build
WORKDIR /src

# admin-ui 依赖
COPY admin-ui/package*.json ./admin-ui/
RUN cd admin-ui && npm install --no-audit --no-fund --registry=${NPM_REGISTRY:-https://registry.npmmirror.com}

# storefront 依赖 (不带 lock 全新安装, 规避 optional 平台依赖 bug)
COPY storefront/package.json ./storefront/
RUN cd storefront && npm install --no-audit --no-fund --registry=${NPM_REGISTRY:-https://registry.npmmirror.com}

COPY . .

# 构建后台 -> internal/web/admin-ui
RUN cd admin-ui && npm run build

# 构建前台 -> .output
RUN cd storefront && npm run build

# ===== Go 构建阶段 =====
FROM golang:1.22-bookworm AS gobuild
ARG GOPROXY=https://goproxy.cn,direct
ENV GOPROXY=${GOPROXY}
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
# 复用前端阶段产物(admin-ui 内嵌)
COPY --from=build /src/internal/web/admin-ui ./internal/web/admin-ui
RUN CGO_ENABLED=0 GOOS=linux go build -trimpath -ldflags="-s -w" -o /out/shop ./cmd/shop

# ===== 运行时: shop API + 后台 =====
FROM alpine:3.20 AS shop
RUN apk add --no-cache ca-certificates tzdata \
    && adduser -D -H -u 10001 shop
WORKDIR /app
COPY --from=gobuild /out/shop /app/shop
RUN mkdir -p /app/data && chown -R shop:shop /app
USER shop
EXPOSE 8080
VOLUME ["/app/data"]
ENV SHOP_LISTEN_ADDR=:8080 SHOP_DATABASE_PATH=/app/data/shop.db
CMD ["/app/shop"]

# ===== 运行时: storefront SSR =====
FROM node:20-alpine AS storefront
RUN adduser -D -H -u 10001 nodeuser
WORKDIR /app
COPY --from=build /src/storefront/.output ./output
# Nitro 从 server/chunks/public 读取静态资源, 需把 public 复制过去
RUN mkdir -p ./output/server/chunks/public \
    && cp -r ./output/public/. ./output/server/chunks/public/ \
    && chown -R nodeuser:nodeuser /app
USER nodeuser
ENV NODE_ENV=production PORT=3000 HOST=0.0.0.0
EXPOSE 3000
CMD ["node", "output/server/index.mjs"]
