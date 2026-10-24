# liteshop v2 · 数字卡密商城

Next.js 16 (App Router) · React 19 · TypeScript Strict · Tailwind CSS v4 · Drizzle ORM · PostgreSQL · Docker Compose + Caddy

纯数字卡密商城：游客下单 → 聚合收银台支付 → 数据库事务原子发卡 → 邮箱 + 查单密码查询订单。无买家账户系统。

## 功能

- **商城**：商品分类与搜索、商品详情（库存实时展示）、购物车与结算、游客下单
- **支付**：BEpusdt 兼容收银台渠道（多实例：LitePay pay.9527.tr / 自建网关），验签、金额核对、回调幂等、超时对账（reconciling）、延迟到账人工核对
- **交付**：支付确认后事务内原子发卡（`FOR UPDATE SKIP LOCKED`，一卡不两卖）；人工发货商品由后台录入；交付邮件自动发送（失败重试）
- **订单查询**：每单独立查单密码（Argon2id），邮箱 + 订单号 + 密码三因子，限流防爆破
- **后台**：独立 Session 认证（scrypt + HMAC 会话 + CSRF）、商品/分类/卡密/订单/渠道/站点设置全功能管理、审计日志
- **SEO**：商品页 ISR + JSON-LD（Product）、sitemap、robots、canonical / OG；订单、支付、后台全部 noindex
- **安全**：服务端金额计算、渠道凭据 AES-256-GCM 加密存储、登录/下单/查询限流、后台入口伪装（ADMIN_PATH）

## 快速开始（开发）

```bash
# 1. 启动开发数据库（或自备 PostgreSQL，写入 .env 的 DATABASE_URL）
docker run -d --name liteshop-pg-dev \
  -e POSTGRES_PASSWORD=liteshop-dev -e POSTGRES_DB=liteshop \
  -p 54329:5432 postgres:18-alpine

# 2. 配置环境
cp .env.example .env   # 填 AUTH_SECRET（openssl rand -hex 32）

# 3. 安装 + 迁移 + 种子
npm install
npm run db:migrate
npm run db:seed        # 创建管理员 admin/admin12345 + 演示商品（仅开发）

# 4. 运行
npm run dev            # http://localhost:3000（后台 /admin）
```

本地默认 `PAYMENT_DRIVER=mock`（.env 设为 auto 时走后台启用的渠道）。
mock 收银台在 `/pay/mock`，一键模拟支付成功回调，跑通完整发卡链路。

## 测试

```bash
# 测试需要独立的 PostgreSQL（vitest 自动迁移）
docker run -d --name liteshop-pg-test \
  -e POSTGRES_PASSWORD=liteshop-test -e POSTGRES_DB=liteshop_test \
  -p 54330:5432 postgres:18-alpine

npm test        # 45 用例：金额/签名/密码单元 + 下单/回调幂等/并发发卡/过期清扫/鉴权集成
npx tsc --noEmit
npm run lint
```

## 生产部署（Docker Compose）

```bash
cp .env.example .env
# 填写：SITE_URL / DOMAIN / AUTH_SECRET / ADMIN_PASSWORD_HASH（npm run hash-password -- <密码>）/ POSTGRES_PASSWORD / CRON_SECRET

docker compose up -d --build
# app 容器启动前自动执行数据库迁移；Caddy 自动签发 HTTPS
# 数据库备份：backup 服务每日 pg_dump 至 ./backups（保留 14 份）
```

架构：`app`（Next standalone，非 root）+ `db`（PostgreSQL 18，仅内网）+ `caddy`（边缘 TLS）+ `backup` + `cron`（每分钟调用维护接口：过期清扫 / 邮件重投 / 日志清理）。

## 业务规则速览

| 规则 | 说明 |
|---|---|
| 订单状态机 | pending → paid → completed；pending → closed / reconciling；reconciling → paid / closed |
| 支付状态机 | pending → confirmed / expired / failed；订单关闭后到账记 late（人工核对） |
| 金额 | 全程最小货币单位整数（分），JPY 等零小数币种特殊处理 |
| 库存 | auto 型下单锁卡（reserved）→ 支付确认（sold）；关单/过期幂等释放 |
| 回调 | 验签（MD5/常量时间比较）→ 金额核对 → `payments(channel, trade_id)` 唯一幂等 → 发卡 |
| 未知结果 | 渠道超时/5xx → reconciling，绝不释放库存（网关可能已建单） |

详细设计见 [PLAN.md](./PLAN.md)。
