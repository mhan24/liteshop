# syntax=docker/dockerfile:1
# 锁定具体小版本；基础镜像用 Debian（glibc）——Turbopack 在 Alpine/musl 上 ARM 会 SIGSEGV
# Node 22：部分 ARM 主机（如 Oracle Neoverse-N1）上 Node 20 原生调用 SQLite 会 SIGSEGV，22/24 正常
# 升级 Node 前先 `npm rebuild better-sqlite3`（见 README）
FROM node:22.23-bookworm-slim AS deps
WORKDIR /app
# better-sqlite3 源码编译回退所需的构建链（glibc 匹配 runner 阶段）
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci && npm rebuild better-sqlite3

FROM node:22.23-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:22.23-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN groupadd --system liteshop && useradd --system --gid liteshop liteshop
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
# SQLite 迁移文件：启动时自动应用
COPY --from=builder /app/drizzle ./drizzle
RUN mkdir -p /app/data && chown -R liteshop:liteshop /app
USER liteshop
EXPOSE 3000
VOLUME ["/app/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
