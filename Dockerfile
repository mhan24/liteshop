# 多阶段构建：deps → builder → runner（standalone，非 root 运行）
FROM node:22-bookworm-slim AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-bookworm-slim AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# 构建期注入站点地址（metadataBase 等），运行时可被 settings.site_url 覆盖
ARG SITE_URL=http://localhost:3000
ENV SITE_URL=$SITE_URL
ENV AUTH_SECRET=build-placeholder-secret-0123456789abcdef
ENV DATABASE_URL=postgres://build:build@localhost:5432/build
RUN npm run build

FROM node:22-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
ENV TZ=Asia/Shanghai

RUN apt-get update \
  && apt-get install -y --no-install-recommends postgresql-client \
  && rm -rf /var/lib/apt/lists/* \
  && groupadd -r liteshop \
  && useradd -r -g liteshop liteshop

COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public
COPY --from=builder /app/drizzle ./drizzle
COPY --from=builder /app/scripts ./scripts
# standalone 的 node_modules 由依赖追踪生成（drizzle-orm 被 Turbopack 打包进 chunk，
# 但启动迁移脚本 scripts/db/migrate.mjs 需要完整包，从 builder 补拷）
COPY --from=builder /app/node_modules/drizzle-orm ./node_modules/drizzle-orm

RUN mkdir -p /app/backups && chown -R liteshop:liteshop /app
USER liteshop

EXPOSE 3000

# 启动前执行版本化迁移（幂等），随后运行应用
CMD ["sh", "-c", "node scripts/db/migrate.mjs && node server.js"]
