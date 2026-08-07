# LiteShop

An automated digital-goods delivery (card/activation-code) shop built with **Go + SQLite**, integrated with the [BEpusdt](https://github.com/v03413/BEpusdt) crypto payment gateway. The buyer storefront uses Nuxt 3 SSR + Tailwind; the admin panel uses Vue 3 + TypeScript + Element Plus + Pinia; Go serves the JSON API and payment callbacks.

基于 **Go + SQLite** 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。买家前台使用 Nuxt 3 SSR + Tailwind，管理后台使用 Vue 3 + TypeScript + Element Plus + Pinia，Go 提供 JSON API 与支付回调。

> This project is not affiliated with the BEpusdt author. BEpusdt is GPL-3.0; this project is MIT.
> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 遵循 GPL-3.0，本项目采用 MIT 协议。

---

## Architecture / 架构

```
User browser / 用户浏览器
    │
    ▼
Cloudflare (CDN/HTTPS)
    │
    ▼
Caddy (reverse proxy :443 / 反向代理 :443)
    ├── /api, /notify, /admin, /health  → Go :8080
    └── /*                               → Nuxt SSR :3001
```

| Process / 进程 | Stack / 技术 | Port / 端口 |
| --- | --- | --- |
| Go API | Go 1.25+ + SQLite (modernc) | 8080 |
| Storefront SSR / 前台 SSR | Nuxt 3 + Tailwind | 3001 |
| Admin SPA / 后台 SPA | Vue 3 + TS + Element Plus + Pinia | embedded in Go / 内嵌进 Go |

---

## Features / 功能

### Storefront (Nuxt 3 SSR) / 前台（Nuxt 3 SSR）

- Product listing: categories / pinned / sorting / 商品列表（分类 / 置顶 / 排序）
- Product detail + Cloudflare Turnstile / 商品详情 + Cloudflare Turnstile
- Checkout: open the BEpusdt checkout in a new tab, redirect to the order page / 下单：新标签页打开 BEpusdt 收银台，当前页跳订单详情页
- Order detail: auto-poll while waiting, cards shown on payment success, cancel order (closes the BEpusdt transaction) / 订单详情：待支付自动轮询、支付成功自动显示卡密、支持取消订单（同步关闭 BEpusdt 交易）
- Order lookup by email / 订单查询：支持仅邮箱找回最近订单
- Privacy / Terms / first-time `/setup` / 隐私 / 服务条款 / 首次初始化 `/setup`
- SEO: canonical / OG / JSON-LD / sitemap / robots / favicon

> Compatibility note / 兼容说明：Legacy orders (created before the view-token feature) still support "email + order number" card access as a transitional mode scheduled for retirement; all new orders use a view token sent by email (token is only mailed to the registered address). The lookup API never returns order numbers or view links — access links are always delivered by email.
> 存量订单（查看令牌功能上线前创建）仍支持"邮箱 + 订单号"访问卡密，属过渡兼容、计划后续下线；新订单一律使用随订单邮件发送的查看令牌（令牌只发往登记邮箱）。邮箱查询接口不返回订单号与查看链接，所有订单的访问链接统一通过邮件下发。

### Admin panel (Element Plus + Pinia) / 后台（Element Plus + Pinia）

- Dashboard: products / cards / orders stats / 仪表盘：商品 / 卡密 / 订单统计
- Products: create / edit / category / pinned / sorting / price / status / 商品：新建 / 编辑 / 分类 / 置顶 / 排序 / 价格 / 上下架
- Cards: import / delete / export / 卡密：导入 / 删除 / 导出
- Orders: view / CSV export / mark expired / resend notification / 订单：查看 / CSV 导出 / 标记过期 / 重发通知
- Payment: BEpusdt base URL / API token / trade types / timeout / public URL / callback URL / 支付：BEpusdt Base URL / API Token / 收款类型 / 超时 / 公开地址 / 回调地址
- Notifications: SMTP / Telegram / mail templates (placeholders) / 通知：SMTP / Telegram / 邮件模板（支持占位符）
- Site: title / announcement / SEO / links / copyright / privacy / terms / Turnstile / 站点：标题 / 公告 / SEO / 链接编辑 / 版权 / 隐私 / 条款 / Turnstile
- Maintenance mode: toggle + notice + unlock password / 维护模式：开关 + 通知文案 + 解锁密码
- Account: username / password / 账号：改用户名 / 改密码
- System: config backup / restore / wipe and re-init / 系统：配置备份 / 恢复 / 清空数据并重新初始化
- Admins: multi-account RBAC (admin / operator / viewer) + audit logs / 管理员：多账号 RBAC（管理员 / 运营 / 只读）+ 审计日志
- TOTP two-factor authentication / TOTP 双因素认证
- Coupons (fixed / percent) and wholesale tiered pricing / 优惠券（固定 / 百分比）与阶梯批发价

### Backend (Go) / 后端（Go）

- SQLite storage (pure Go, no CGO); all configuration in the `settings` table, no `.env` / SQLite 存储（纯 Go，无需 CGO），所有配置存 `settings` 表，无 `.env`
- BEpusdt integration: create / cancel transaction, callback signature verification (MD5) / BEpusdt 对接：创建交易、取消交易、回调验签（MD5）
- Rate limiting (orders 20/min, login 10/min, etc.) / API 限流（下单 20/分，登录 10/分等）
- Security headers (X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy) + admin CSP / 安全头 + 后台 CSP
- Health check `/health` / 健康检查 `/health`
- First-time initialization `/setup` (optional `SHOP_SETUP_TOKEN`) / 首次初始化 `/setup`（可选初始化令牌）

---

## Payment flow / 支付流程

```
Order → lock cards → create BEpusdt transaction → open checkout in a new tab
  → redirect to the order page (auto-polling)
  → user pays → BEpusdt callback /notify/bepusdt → verify signature → order paid
  → cards sold → email/Telegram notification → cards shown on the order page
```

下单 → 锁定卡密 → 创建 BEpusdt 交易 → 新标签页打开收银台 → 原页跳订单详情页（自动轮询）→ 用户转账 → BEpusdt 回调 `/notify/bepusdt` → 验签 → 订单 paid → 卡密 sold → 邮件/Telegram 通知 → 前台自动显示卡密。

Cancel / expire: release stock and call BEpusdt `cancel-transaction` / 取消 / 过期：释放库存 + 同步调用 BEpusdt `cancel-transaction` 关闭交易。

---

## Tech stack / 技术栈

| Layer / 层 | Stack / 技术 |
| --- | --- |
| Storefront / 前台 | Nuxt 3 SSR + Tailwind CSS |
| Admin / 后台 | Vue 3 + Vite + TypeScript + Element Plus + Pinia |
| Backend / 后端 | Go 1.25+ |
| Database / 数据库 | SQLite (modernc.org/sqlite) |
| Reverse proxy / 反向代理 | Caddy |
| Payment / 支付 | BEpusdt |
| Security / 安全 | Cloudflare Turnstile |

---

## Directory structure / 目录结构

```
cmd/shop/            Go entrypoint / Go 程序入口
internal/config/     configuration defaults / 配置（纯默认值）
internal/db/         SQLite migrations & settings / SQLite 迁移与设置读写
internal/models/     models & helpers / 模型与工具
internal/bepusdt/    BEpusdt create/cancel/sign/verify / BEpusdt 对接
internal/notify/     email / Telegram notifications / 邮件 / Telegram 通知
internal/order/      order domain (service + repository) / 订单领域
internal/product/    product domain / 商品领域
internal/security/   TOTP & AES-GCM cipher / TOTP 与加密
internal/web/        HTTP routes, JSON API, embedded admin SPA / HTTP 路由、JSON API、后台静态资源嵌入
admin-ui/            Element Plus admin (TS + Pinia) / 后台
storefront/          Nuxt 3 SSR storefront (Tailwind) / 前台
```

---

## Development / 开发

### Prerequisites / 前置要求

- Go 1.25+
- Node.js 18+ / npm
- A BEpusdt instance / BEpusdt 实例

### Local development / 本地开发

Backend (8080) / 后端（8080）：

```bash
go run ./cmd/shop
```

Admin (5174) / 后台（5174）：

```bash
cd admin-ui && npm install && npm run dev
```

Storefront (3001) / 前台（3001）：

```bash
cd storefront && npm install && npm run dev
```

### Build / 构建

```bash
# Admin static assets → internal/web/admin-ui
cd admin-ui && npm install && npm run build && cd ..

# Storefront SSR output → storefront/.output
cd storefront && npm install && npm run build && cd ..

# Single Go binary (embeds the admin UI) / Go 单体二进制（内嵌后台）
go build -o shop ./cmd/shop
./shop
```

> `internal/web/admin-ui` is a build artifact, ignored by `.gitignore`, not committed / 是后台构建产物，已被 `.gitignore` 忽略，不提交到仓库。

---

## Deployment (server) / 部署（服务器）

### Docker (NAS / panels) / Docker 部署

```bash
cp .env.example .env     # set DOMAIN / 设置 DOMAIN
docker compose up -d --build
```

| Service / 服务 | Description / 说明 | Port / 端口 |
| --- | --- | --- |
| `liteshop` | Go API + embedded admin / Go API + 内嵌后台 | internal 8080 |
| `storefront` | Nuxt SSR / 前台 | internal 3000 |
| `caddy` | reverse proxy + auto HTTPS / 反向代理 + 自动 HTTPS | 80 / 443 |
| `sqlite` | data in named volume `liteshop_data` / 数据存命名卷 | — |

- Open `https://<DOMAIN>/setup` for first-time initialization / 首次打开 `https://<DOMAIN>/setup` 完成初始化
- BEpusdt callback: `https://<DOMAIN>/notify/bepusdt` / BEpusdt 走公网回调

### One-click install / 一键安装（10 分钟）

On a fresh Ubuntu / Debian / CentOS / Rocky / Alma server, point the domain A record to the server, then:

```bash
# Source build mode (~10 min; installs Go/Node/Caddy/systemd/SSL automatically)
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | DOMAIN=shop.example.com bash

# Fast mode (recommended): prebuilt artifact, ~2 min
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | \
  DOMAIN=shop.example.com BUILD_ARTIFACT=https://…/liteshop-release.tgz bash
```

Env vars / 环境变量：`DOMAIN` (required / 必填), `EMAIL` (Let's Encrypt), `BRANCH`, `SKIP_SSL=1` (plain http / 纯 http), `BUILD_ARTIFACT` (prebuilt tgz), `SHOP_USER`, `SHOP_SETUP_TOKEN` (optional init token to protect `/setup` / 可选初始化令牌，防止 `/setup` 被抢占).

### Manual deployment / 手动部署

- Go: systemd `cardshop`, runs `/opt/cardshop/shop`, listens on 8080
- Storefront: systemd `liteshop-storefront`, runs `/opt/liteshop-storefront/server/index.mjs`, listens on 3001
- Caddy: route API/admin/callback to Go, everything else to Nuxt

---

## Tests & CI / 测试与 CI

- Go unit tests: `go test ./...` (BEpusdt signing/verification, price conversion, order numbers, password hashing, state machine) / Go 单元测试
- CI (`.github/workflows/ci.yml`): Go `vet` / `build` / `test` (linux-arm64 artifact) + admin-ui and storefront builds

---

## Caching & SEO / 缓存与 SEO

Caddy cache headers / Caddy 缓存头策略：

| Path / 路径 | Cache-Control |
| --- | --- |
| `/_nuxt/*`, `/assets/*`, `/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`, `/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/api/*`, `/admin/*`, `/order*`, `/setup`, `/health` | `no-store` + `X-Robots-Tag: noindex` |

- HTML pages are not cached by default (SSR dynamic); Nuxt outputs canonical / OG / JSON-LD.
- `robots.txt` outputs a `Sitemap:` pointer; `sitemap.xml` dynamically includes product URLs.
- Security headers are set by Caddy / Go: `X-Content-Type-Options`, `X-Frame-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS.

> **Cloudflare note / 提示**: if Cloudflare's "Managed robots.txt" is enabled, it may merge/override `robots.txt`. Disable it in Cloudflare → Bots / Scrape Shield if you need the origin to fully control robots and cache headers.

---

## BEpusdt integration / BEpusdt 对接

- Get the API token from the BEpusdt admin panel / 在 BEpusdt 后台获取 API Token
- Create transaction → redirect to checkout; cancel/expire calls `cancel-transaction` / 创建交易后跳转收银台；取消 / 过期调用 `cancel-transaction`
- Payment success callback `/notify/bepusdt` / 支付成功回调
- Signature: sorted params + API token, MD5; empty/null values are excluded / 签名：参数排序拼接 + API Token 后 MD5，空值/null 不参与

> MD5 signing is the fixed requirement of the BEpusdt protocol and cannot be replaced unilaterally; security relies on the shared API token / MD5 签名是 BEpusdt 网关协议的固定要求，安全性依赖于双方共享的 API Token。

---

## Cloudflare Turnstile

- The storefront checkout embeds Turnstile / 前台下单页嵌入 Turnstile
- Backend verifies via canonical siteverify before creating an order; the hostname must match (relaxed for IP/local access) / 后端调用 canonical siteverify 校验，含 hostname 匹配

---

## Security notes / 安全说明

- Passwords: PBKDF2-SHA256 (100k iterations) + constant-time compare / 密码 PBKDF2-SHA256 10 万次
- TOTP 2FA secrets encrypted with AES-GCM (derived from `session_secret`) / TOTP 密钥 AES-GCM 加密
- Order view tokens: random per-order tokens delivered only by email; constant-time comparison / 订单查看令牌只经邮件下发
- Sessions persisted in SQLite with HMAC-signed cookies; revoked immediately on logout / admin deletion / restore / reset / 会话持久化 + 即时吊销
- All SQL parameterized; markdown rendering disables HTML; CSV export guards formula injection / SQL 全参数化、markdown 关闭 HTML、CSV 注入防护
- Config backups exclude secret keys (payment / SMTP / Telegram / Webhook / Turnstile / maintenance password) / 配置备份不包含密钥类配置
- Rate limits on orders / login / 2FA / maintenance unlock / order lookup / order detail / cancel / order links / setup / 全接口限流

---

## License / 许可证

MIT, see [LICENSE](LICENSE).
