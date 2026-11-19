# liteshop · 数字卡密商店

Next.js 16 (App Router) · React 19 · TypeScript Strict · Tailwind CSS v4 · Drizzle ORM · PostgreSQL · Docker Compose + Caddy

只卖数字卡密：游客下单 → LitePay 收银台付款 → 事务内原子发卡 → 页面展示 + 邮件同步 → 凭订单号/邮箱/查单密码查询。没有买家账户。

## 功能

- **商城**：分类与搜索、商品详情（库存实时）、购物车、游客下单
- **支付**：单一 LitePay 网关（BEpusdt 兼容接口），验签、金额核对、回调幂等、超时对账（reconciling）、延迟到账人工核对
- **交付**：支付确认后事务内原子发卡（`FOR UPDATE SKIP LOCKED`，一卡不两卖），交付邮件自动发送并重试
- **订单查询**：每单独立查单密码（Argon2id），订单号 + 邮箱 + 密码三因子，限流防爆破
- **后台**：Session 认证（scrypt + HMAC 会话 + CSRF）、商品/分类/卡密/订单/站点设置/支付网关、审计日志
- **SEO**：商品页 ISR + JSON-LD、sitemap、robots、canonical / OG；订单、支付、后台全部 noindex
- **安全**：服务端金额计算、网关令牌 / SMTP 密码 / Turnstile Secret 均 AES-GCM 加密存储、CSP + HSTS、登录/下单/查询限流、后台入口伪装（ADMIN_PATH）

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

本地把 `PAYMENT_DRIVER` 设为 `mock` 即可不接真实网关：模拟收银台在 `/pay/mock`，点一下就能跑通「下单 → 回调 → 发卡」全链路。

## 测试

```bash
# 测试需要独立 PostgreSQL（vitest 自动迁移）
docker run -d --name liteshop-pg-test \
  -e POSTGRES_PASSWORD=liteshop-test -e POSTGRES_DB=liteshop_test \
  -p 54330:5432 postgres:18-alpine

npm test        # 94 用例：金额/签名/适配器/入口伪装单元 + 下单/回调幂等/并发发卡/补货重发/过期清扫/鉴权集成
npx tsc --noEmit
npm run lint
```

## 生产部署（Docker Compose）

```bash
cp .env.example .env
# 填写：SITE_URL / DOMAIN / PAY_DOMAIN / AUTH_SECRET / ADMIN_PASSWORD_HASH（npm run hash-password -- <密码>）/ POSTGRES_PASSWORD / CRON_SECRET

docker compose up -d --build
# app 容器启动前自动执行数据库迁移（含破坏性的 0001）；Caddy 自动签发 HTTPS
# 数据库备份：backup 服务每日 pg_dump 至 ./backups（保留 14 份）
```

上线后在后台「设置 · 支付网关」填 LitePay 的网关地址与接口令牌，并把
`https://<站点>/api/webhooks/litepay` 填到网关的商店设置里。

### 日常部署

镜像由 CI 构建：推送到 `main` 后，测试全部通过才会在 arm64 机器上构建镜像，推到
`ghcr.io/mhan24/liteshop:<提交号>`。部署脚本只负责让服务器拉取并切换，本机不需要 Docker：

```bash
scripts/deploy.sh             # 部署 origin/main 最新提交（CI 镜像需已构建完）
scripts/deploy.sh <提交号>     # 部署指定版本；回滚也用它
HATOBA_HOST=ORACLE scripts/deploy.sh   # 远程命令改经 Hatoba 执行（凭据留在 Hatoba，不用本机 SSH 密钥）
```

脚本会依次：确认镜像存在 → 校验服务器 `.env` 指纹与 `DOMAIN` → 暂存目录校验新编排 →
备份数据库 → 拉镜像 → 切换并滚动更新 → 健康检查 → 复核 `.env` 指纹未变。

注意：回滚镜像不包含数据库回滚。含破坏性迁移的版本（如 0002 配置表重构）回滚时，
还要同时恢复部署前的 `backups/pre-deploy-*.dump`。

### 备份

- `backup`：每天备份到 `./backups`（保留 14 份），每份做完整性检查；每周日完整恢复到临时库、
  核对订单/卡密数量（恢复演练）。最近一次结果见 `backups/status.json`。
- `offsite`：每天把备份**加密**上传到异地存储（R2 / S3 / B2 / SFTP 等，rclone 支持的都行），远端保留 30 天。
  配置：把 `.env.offsite.example` 复制为服务器上的 `/opt/liteshop/.env.offsite` 并填写；未配置时只打印提醒。

### 运营通知

后台「设置 · 运营通知」填 Telegram Bot Token 与 Chat ID 后，订单待核实、延迟到账、
付款后卡密不足、库存跌破阈值或售罄时会推送消息。

架构：`app`（Next standalone，非 root）+ `db`（PostgreSQL 18，仅内网）+ `caddy`（边缘 TLS）+
`backup` + `offsite` + `cron`（每分钟：过期清扫 / 邮件重投 / 通知投递 / 日志清理）。

## 业务规则速览

| 规则 | 说明 |
|---|---|
| 订单状态机 | pending → paid → completed；pending → closed / reconciling；reconciling → paid / closed |
| 支付状态机 | pending → confirmed / expired / failed；订单关闭后到账记 late（人工核对） |
| 金额 | 全程美分整数，全站 USD；建单金额 0.01–999999.99 |
| 库存 | 下单锁卡（reserved）→ 支付确认（sold）；关单/过期幂等释放 |
| 回调 | 验签（MD5/常量时间比较）→ 金额核对 → `payments(channel, provider_ref)` 唯一幂等 → 发卡 |
| 未知结果 | 网关超时/5xx → reconciling，绝不释放库存（网关可能已建单） |

详细设计见 [PLAN.md](./PLAN.md)，界面规范见 [DESIGN.md](./DESIGN.md)，审计记录见 [AUDIT.md](./AUDIT.md)。
