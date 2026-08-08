# LiteShop

English: [README.en.md](README.en.md)

基于 **Go + SQLite** 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。买家前台使用 Nuxt 3 SSR + Tailwind，管理后台使用 Vue 3 + TypeScript + Element Plus + Pinia；Go 提供 JSON API、支付回调与内嵌后台。

> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 遵循 GPL-3.0，本项目采用 MIT 协议。

---

## 功能

### 前台（Nuxt 3 SSR）

- 商品列表：分类 / 置顶 / 排序 / 搜索 / 价格筛选
- 商品详情 + Cloudflare Turnstile 人机验证
- 下单：新标签页打开 BEpusdt 收银台，当前页跳转订单详情
- 订单详情：待支付自动轮询、支付成功自动显示卡密、支持取消订单（同步关闭 BEpusdt 交易）
- 订单查询：仅邮箱找回 + "发送查看链接到邮箱"
- 访问说明：所有订单（含存量）凭随邮件发送的查看令牌访问卡密/取消；令牌只发往登记邮箱，邮箱查询接口不返回订单号与链接
- 隐私 / 服务条款 / 首次初始化 `/setup`
- SEO：canonical / OG / JSON-LD / sitemap / robots / favicon

### 后台（Vue 3 SPA）

- 仪表盘：商品 / 卡密 / 订单统计、销售趋势与商品占比、毛利（成本快照）
- 商品：新建 / 编辑 / 分类 / 置顶 / 排序 / 价格 / 上下架 / FAQ / 批发阶梯价
- 卡密：导入（去重）/ 删除 / 导出
- 订单：查看 / CSV 导出 / 标记过期 / 重发 / 批量重发 / 补发
- 优惠券：固定 / 百分比、最低金额、使用次数、适用商品、有效期；100% 券订单自动完成并直接发卡
- 支付：BEpusdt Base URL / Token / 收款类型 / 超时 / 回调地址
- 通知：SMTP / Telegram / Webhook + **事件模板**（订单创建 / 付款成功 / 发货 / 库存不足 / 系统异常）+ 管理员通知邮箱 + 测试按钮
- 站点：标题 / 公告 / 公开地址 / Logo / Favicon / SEO / 链接 / 版权 / 隐私 / 条款 / Turnstile
- 维护模式：开关 + 提示文案 + 解锁密码（哈希存储）
- 账号：改用户名 / 改密码
- 安全：TOTP 二次验证（Google Authenticator，密钥 AES 加密）、管理员 RBAC + 审计日志
- 系统：配置备份 / 恢复（不含密钥）/ 清空并重新初始化

### 后端（Go）

- SQLite 存储（纯 Go，无 CGO）；无应用级环境变量，**全部配置在初始化与管理后台写入数据库**
- 配置系统：`settings`（系统配置）+ `secrets`（敏感配置，AES-GCM 加密：BEpusdt Token / SMTP 密码 / Telegram Token / Webhook Secret / Turnstile Secret / 维护密码）
- 任务系统：进程内 goroutine + channel 异步 worker（邮件 / Telegram / Webhook），HTTP 层只发布事件
- 后台任务（cron + worker）：订单超时自动关闭、失败邮件重试、会话/日志清理、每日数据库备份
- 支付对接：创建 / 取消交易、回调验签（MD5）、单事务幂等发卡
- 管理员安全：PBKDF2-SHA256 密码、TOTP 2FA、**登录失败 5 次锁定 10 分钟**、登录时序均摊防枚举
- 安全：RBAC、审计日志、全接口限流、Turnstile、CSP、HSTS、安全响应头、CSV 注入防护、SQL 全参数化
- 健康检查 `/health`、首次初始化 `/setup`

---

## 架构

```
用户浏览器
    │
    ▼
Cloudflare (CDN/HTTPS)
    │
    ▼
Caddy (反向代理 :443)
    ├── /api, /notify, /admin, /health  → Go :8080
    └── /*                               → Nuxt SSR :3001
```

| 进程 | 技术 | 端口 |
| --- | --- | --- |
| Go API | Go 1.25+ + SQLite (modernc) | 8080 |
| 前台 SSR | Nuxt 3 + Tailwind | 3001 |
| 后台 SPA | Vue 3 + TS + Element Plus + Pinia | 内嵌进 Go |

### 分层与数据访问

```
HTTP handler (internal/api)
    → service (internal/service)
    → repository (internal/repository)
    → database/sql (internal/db：sqlite.go / postgres.go 未来备用)
```

- `OrderRepository` / `ProductRepository` / `KeyRepository`（卡密）集中所有 SQL；
- 业务代码不散落 `db.Exec`；换数据库只需换驱动 + 迁移方言。

### 数据库迁移（Migrations）

- 迁移文件位于 `internal/db/migrations/`，编号命名（`001_init.sql`、`002_...`、…），按序执行；
- 每个已执行迁移记录在 `schema_migrations`，**只执行一次**，重启不重复执行；
- 规范：**新增 schema 变更必须新增编号 .sql 迁移文件**，禁止在启动时"检查表 / 自动补列"；
- 仅 SQLite 无法用纯 SQL 表达的存量升级（条件 ALTER / 表重建 / 数据迁移）使用 Go 迁移步骤。

---

## 支付流程

```
下单 → 锁定卡密 → 创建 BEpusdt 交易 → 新标签页打开收银台
  → 原页跳订单详情页（自动轮询）
  → 用户转账 → BEpusdt 回调 /notify/bepusdt → 验签 → 订单 paid
  → 发布任务 → worker 发卡通知（邮件/Telegram）→ 前台显示卡密
```

取消 / 过期：释放库存 + 调用 BEpusdt `cancel-transaction` 关闭交易。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前台 | Nuxt 3 SSR + Tailwind CSS |
| 后台 | Vue 3 + Vite + TypeScript + Element Plus + Pinia |
| 后端 | Go 1.25+ |
| 数据库 | SQLite (modernc.org/sqlite) |
| 反向代理 | Caddy |
| 支付 | BEpusdt |
| 安全 | Cloudflare Turnstile |

---

## 目录结构

```
cmd/shop/               Go 程序入口
internal/api/           HTTP 路由、JSON API、内嵌后台（handler 层）
internal/service/       业务逻辑（OrderService / ProductService）
internal/repository/    数据访问（OrderRepository / ProductRepository / KeyRepository）
internal/db/            数据库层：sqlite.go / postgres.go（未来备用）/ migrations / settings+secrets
internal/models/        模型与工具
internal/payment/       BEpusdt 支付对接
internal/notify/        通知（事件模板 / 邮件 / Telegram / Webhook）
internal/jobs/          后台任务：调度器 + order_expire / email_retry / cleanup / backup
internal/security/      TOTP 与 AES-GCM 加密
internal/config/        配置默认值
admin-ui/               Element Plus 后台（src/api|views|stores|hooks|utils|components）
storefront/             Nuxt 3 SSR 前台
```

---

## 开发

### 前置要求

- Go 1.25+
- Node.js 18+ / npm
- BEpusdt 实例

### 本地开发

后端（8080）：

```bash
go run ./cmd/shop
```

后台（5174）：

```bash
cd admin-ui && npm install && npm run dev
```

前台（3001）：

```bash
cd storefront && npm install && npm run dev
```

### 构建

```bash
# 后台静态资源 → internal/api/admin-ui
cd admin-ui && npm install && npm run build && cd ..

# 前台 SSR 产物 → storefront/.output
cd storefront && npm install && npm run build && cd ..

# 单二进制（内嵌后台）
go build -o shop ./cmd/shop
./shop
```

> `internal/api/admin-ui` 是后台构建产物，已被 `.gitignore` 忽略，不提交。

---

## 部署（服务器）

### 一键安装（install.sh）

在全新 Ubuntu / Debian / CentOS / Rocky / Alma 服务器上，域名 A 记录指向服务器后：

```bash
# 源码构建模式（约 10 分钟，自动装 Go/Node/Caddy/systemd/SSL）
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | DOMAIN=shop.example.com bash

# 快速模式（推荐）：预构建产物，约 2 分钟
curl -sSL https://raw.githubusercontent.com/mhan24/liteshop/main/install.sh | \
  DOMAIN=shop.example.com BUILD_ARTIFACT=https://…/liteshop-release.tgz bash
```

脚本自动完成：系统检测 → 依赖/Go/Node/Caddy → 构建或解压产物 → 运行用户与目录 → systemd → Caddyfile + 自动 HTTPS → 启动。

安装期变量：`DOMAIN`（必填）、`EMAIL`、`BRANCH`、`SKIP_SSL=1`（纯 http）、`BUILD_ARTIFACT`、`SHOP_USER`。

> 运行时配置（站点地址、支付、通知等）在 `/setup` 初始化与后台写入数据库，应用不读取任何环境变量。

### 构建部署（build-release.sh）

```bash
bash build-release.sh /tmp/liteshop-release.tgz   # shop 二进制 + storefront/.output
```

产物可通过 `install.sh` 的 `BUILD_ARTIFACT` 快速部署。

### 手动部署

- Go：systemd `cardshop`，运行 `/opt/cardshop/shop`，监听 8080
- 前台：systemd `liteshop-storefront`，运行 `/opt/liteshop-storefront/server/index.mjs`，监听 3001
- Caddy：API/后台/回调分流到 Go，其余到 Nuxt

---

## 测试与 CI

- Go：`go test ./...`（签名验签、价格换算、订单号、密码哈希、状态机、优惠券/免费订单、会话、登录锁定、任务总线）
- CI（`.github/workflows/ci.yml`）：Go `vet` / `build` / `test` + 后台/前台构建

---

## 缓存与 SEO

| 路径 | Cache-Control |
| --- | --- |
| `/_nuxt/*`、`/assets/*`、`/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`、`/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/`、`/api/*`、`/admin/*`、`/order*`、`/product*`、`/page*`、`/setup`、`/health` | `no-store` + `X-Robots-Tag: noindex` |

- HTML 动态页面不缓存；canonical / OG / JSON-LD 由 Nuxt 输出；sitemap 动态包含商品 URL。
- 站点源取自数据库 `public_base_url`，不依赖 Host/环境变量。

---

## BEpusdt 对接

- 后台获取 API Token（加密存储）
- 创建交易 → 跳转收银台；取消/过期调用 `cancel-transaction`
- 支付成功回调 `/notify/bepusdt`（路径可自定义）
- 签名：参数排序拼接 + Token 后 MD5（协议固定要求，空值不参与）

---

## Cloudflare Turnstile

- 前台下单/订单查询嵌入 Turnstile
- 后端 canonical siteverify 校验（含 hostname 匹配，IP/本地放宽）

---

## 安全说明

- 密码 PBKDF2-SHA256（10 万次）+ 恒定时间；登录时序均摊；**失败 5 次锁 10 分钟**
- TOTP 2FA 密钥 AES-GCM 加密；敏感配置（支付/邮件/通知/维护密码）AES 加密存储于 `secrets` 表
- 订单查看令牌只经邮件下发；会话持久化 + 删号/登出/恢复/重置即时吊销
- 状态机原子化（发卡/取消/过期单事务）；100% 券订单直接完成
- SQL 全参数化；markdown 关闭 HTML；CSV 公式注入防护；CSP/HSTS/安全头
- 配置备份不含密钥；HTTP 服务显式超时；异步任务不阻塞支付回调

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
