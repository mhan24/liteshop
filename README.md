# LiteShop

English: [README.en.md](README.en.md)

**LiteShop v0.1.0** —— 基于 **Go + SQLite** 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。买家前台使用 Nuxt 3 SSR + Tailwind；管理后台使用 Vue 3 + TypeScript + Element Plus + Pinia；Go 提供 JSON API、支付回调、内嵌后台与后台任务。

> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 遵循 GPL-3.0，本项目采用 MIT 协议。

---

## 功能

### 前台（Nuxt 3 SSR）

- 商品列表：分类 / 置顶 / 排序 / 搜索 / 价格筛选
- 商品详情 + Cloudflare Turnstile 人机验证
- 下单：新标签页打开收银台，当前页跳转订单详情
- 订单详情：待支付自动轮询、支付成功自动显示卡密、支持取消订单（同步关闭网关交易）
- 订单查询：仅邮箱找回 + "发送查看链接到邮箱"（模糊响应，不泄露邮箱是否下过单）
- 访问凭证：所有订单（含存量回填）凭随邮件发送的**查看令牌**访问卡密/取消；令牌只发往登记邮箱，邮箱查询接口不返回订单号与链接
- 隐私 / 服务条款 / 首次初始化 `/setup`
- SEO：canonical / OG / JSON-LD / sitemap / robots / favicon

### 后台（Vue 3 SPA）

- 仪表盘：商品 / 卡密 / 订单统计、销售趋势与商品占比、毛利（成本快照）、低库存告警
- 商品：新建 / 编辑 / 分类 / 置顶 / 排序 / 价格 / 上下架 / FAQ / 批发阶梯价 / 限购
- 卡密：导入（去重）/ 删除 / 导出
- 订单：查看 / CSV 导出 / 标记过期 / 取消 / 改状态 / 重发 / 批量重发 / 补发
- 优惠券：固定 / 百分比、最低金额、使用次数、适用商品、有效期；**100% 券订单自动完成并直接发卡**
- 支付：网关 Base URL / Token / 收款类型 / 超时 / 回调地址
- 通知：SMTP / Telegram / Webhook + **事件模板**（订单创建 / 付款成功 / 发货 / 库存不足 / 系统异常）+ 管理员通知邮箱 + 测试按钮
- 站点：标题 / 公告 / **公开地址** / Logo / Favicon / SEO / 链接 / 版权 / 隐私 / 条款 / Turnstile
- 维护模式：开关 + 提示文案 + 解锁密码（哈希 + 加密存储）
- 账号：改用户名 / 改密码
- 安全：TOTP 二次验证（Google Authenticator，密钥 AES 加密）、管理员 RBAC + 审计日志
- 系统：配置备份 / 恢复（不含密钥）/ 清空并重新初始化 / **后台任务状态**（每个任务最后执行结果 + 邮件队列积压数）

### 后端（Go）

- SQLite 存储（纯 Go，无 CGO）；无应用级环境变量，**全部配置在初始化与管理后台写入数据库**
- 配置系统：`settings`（系统配置）+ `secrets`（敏感配置 AES-GCM 加密）
- 配置版本：`settings_version` 记录配置结构升级版本（Laravel 风格编号步骤，只执行一次），升级配置不再靠猜；`/health` 与 `/api/v1/admin/version` 直接显示
- 分层：api（handler）→ service（业务）→ db/repository（数据）→ db/schema（schema 演进）；payment / notify / jobs / logging 按职责独立
- 支付抽象：订单业务只依赖 `payment.Gateway` 接口，当前实现为 BEpusdt，换网关不改业务
- 状态模型分离：**订单状态**（履约生命周期：created / waiting_payment / paid / processing / delivered / completed / cancelled / expired / payment_failed / delivery_failed）与**支付状态**（payment_status 独立列：created / pending / confirmed / failed / cancelled）解耦，支付异常不会污染订单语义（如"支付成功但发卡失败"= 订单 delivery_failed + 支付 confirmed）
- 任务系统：进程内 goroutine + channel（邮件 / Telegram / Webhook），HTTP 层只发布事件
- 领域事件：`internal/events` 类型化事件（OrderPaid / OrderExpired / DeliveryFailed / LowStock …），service 只发布事件、不散落 `bus.Publish`，装配层统一分发
- 幂等台账：外部事件（支付回调）以网关交易号登记 `processed_events` 唯一键，与订单状态迁移同一事务，重复通知只处理一次
- 后台任务（ticker + worker）：订单超时自动关闭、失败邮件重试、会话/日志清理、每日数据库备份（含完整性校验）
- 日志（zap）：app / payment / security 三通道，50MB 轮转保留 7 份
- 迁移体系：编号 .sql 迁移（`internal/db/schema/migrations/`），只执行一次并记录
- 管理员安全：PBKDF2-SHA256、TOTP 2FA、**登录失败 5 次锁定 10 分钟**、登录时序均摊防枚举
- 安全：RBAC、审计日志、全接口限流、Turnstile、CSP、HSTS、安全响应头、CSV 注入防护、SQL 全参数化
- 可观测性：组件级健康检查 `/health`（database / payment）、版本注入、结构化启动横幅
- 日志关联：每个 HTTP 请求自动生成 `request_id`（响应头 `X-Request-ID`），支付日志携带 `request_id` / `order_id` / `trace_id`（网关交易号），一条支付链路可整线串起
- 数据库连接：`journal_mode=WAL` + `busy_timeout=5000` + `foreign_keys=ON` + `_txlock=immediate`（启动即生效，并发读写友好）
- 优雅停机：SIGTERM/SIGINT → 停止接收请求 → 等待在途请求 → worker 退出 → 关闭数据库（systemd/Docker 友好）
- API 文档：`/docs`（OpenAPI 3.0，json + yaml 双格式，`/swagger` 别名），仅管理员可见

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

### 分层

```
HTTP handler (internal/api)
    → service (internal/service)
        → 接口（OrderRepository / ProductRepository / KeyRepository / SettingsStore / AdminStore）
        → internal/db/repository（SQLite 实现）+ internal/db/schema（迁移）
```

- handler 只做请求解析/响应与 HTTP 安全（Turnstile / 限流 / Cookie / 鉴权中间件），不直连数据库、不调支付网关、不发送通知；
- 业务全部经 `service`（Order / Product / Admin / Settings / Notify / Stats），**service 只依赖接口**，不绑定具体 SQLite，测试可用内存 mock；共享类型与领域错误在 `internal/models`；
- `internal/db/repository` 集中全部 SQL（Order / Product / Key / Coupon / Admin / Session / Setting / Secret / MailQueue / Log），另有 `Store` 把配置/管理员/会话/审计收敛为接口实现；
- 支付走 `payment.Gateway` 接口（BEpusdt 实现），业务不绑定具体网关；
- 通知经 `internal/notify` + 任务总线异步执行；后台任务经 `internal/jobs` 调度。

### 数据库迁移（Laravel 风格）

- 迁移文件 `internal/db/schema/migrations/`，编号命名（`001_init.sql`、`002_...`、…），按序执行；
- 每个迁移记录在 `schema_migrations`，**只执行一次**，重启不重复；
- 规范：**新增 schema 变更必须新增编号 .sql 文件**，禁止启动时"检查表 / 自动补列"；
- 仅 SQLite 无法纯 SQL 表达的存量升级（条件 ALTER / 表重建 / 数据迁移）使用 Go 迁移步骤。

### 任务与后台任务

- **任务总线**（`internal/jobs/bus.go`）：goroutine + channel，通知（邮件/Telegram/Webhook）异步执行；
- **后台任务**（`internal/jobs/scheduler.go`）：Go ticker 调度
  - `order_expire`：每 5 分钟关闭超时未支付订单、释放卡密（不依赖用户访问）
  - `email_retry`：失败邮件入 `mail_queue`，指数退避重试（最多 5 次）
  - `cleanup`：过期会话 / 180 天日志 / 内存状态清理
  - `backup`：每日 `VACUUM INTO` 一致性快照 + **只读打开执行 `integrity_check` 校验**（校验失败自动删除坏文件），保留最近 7 份
- 健壮性：worker/调度任务 panic 隔离（单任务崩溃不拖垮进程）；`order_expire` / `email_retry` / `cleanup` 启动后立即执行一次（进程崩溃后的补偿清理）
- **执行记录**：每次任务执行写入 `job_runs`（job_name / started_at / finished_at / status / error），后台 `GET /api/v1/admin/jobs` 直接展示"最后备份: 成功 / 邮件队列: N"等状态，不再只靠日志

---

## 支付流程

```
下单 → 锁定卡密 → 创建交易（payment.Gateway）→ 新标签页打开收银台
  → 原页跳订单详情页（自动轮询）
  → 用户转账 → 网关回调 → 验签（Gateway.VerifyCallback）→ 订单 paid
  → 发布任务 → worker 发卡通知（邮件/Telegram/Webhook）→ 前台显示卡密
```

- 取消 / 过期：释放库存 + 调用网关 `cancel-transaction` 关闭交易；
- 事务边界：下单 = 单事务（建单 + 锁卡 + 扣库存），失败原子置 `payment_failed` 并释放卡密；支付成功 = 单事务（paid + 发卡），**COMMIT 后才异步发通知**，事务内绝不发邮件；
- 并发库存：SQLite `_txlock=immediate`（BEGIN 即取写锁）+ 单条条件 UPDATE 锁卡并校验受影响行数——两个用户同时买最后一张卡时恰好一人成功，不超卖、不重复锁定；
- 支付回调路径可自定义（默认 `/notify/bepusdt`），配置存于数据库；
- 换网关（其他 USDT / Stripe / PayPal）只需新增一个实现 `Gateway` 的适配器，业务与回调处理无需改动；
- **payment.log** 记录每次创建/回调：订单号、金额、交易 ID、回调时间、结果，便于排查支付链路。
- 幂等：支付回调以 `transaction_id` 为唯一键登记 `processed_events`，与订单状态变更同事务提交，重复回调零副作用。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前台 | Nuxt 3 SSR + Tailwind CSS |
| 后台 | Vue 3 + Vite + TypeScript + Element Plus + Pinia + VueUse + unplugin-auto-import |
| 后台质量 | ESLint（flat config + typescript-eslint + eslint-plugin-vue）+ Prettier |
| API 类型 | OpenAPI → TS 自动生成（`admin-ui npm run gen:api` → `src/api/types.ts`），与后端规范零漂移 |
| 后端 | Go 1.25+ |
| 数据库 | SQLite (modernc.org/sqlite)，迁移 + 接口化仓储分层 |
| 日志 | go.uber.org/zap + lumberjack |
| 任务 | goroutine + channel + ticker（无 MQ） |
| 反向代理 | Caddy |
| 支付 | BEpusdt（`payment.Gateway` 接口抽象） |
| 安全 | Cloudflare Turnstile |

---

## 目录结构

```
cmd/shop/               Go 程序入口
internal/api/           HTTP 路由、JSON API、支付回调、内嵌后台、API 文档（handler 层，只做 HTTP 适配）
internal/service/       业务逻辑（按领域拆小文件：order_create.go / settings_payment.go / admin_users.go …）
internal/service/repository.go    service 依赖的数据访问接口（Order/Product/Key/SettingsStore/AdminStore）
internal/db/            数据库连接层：sqlite.go / postgres.go（未来备用）
internal/db/schema/     schema 演进：迁移执行器 + migrations/*.sql（唯一 schema 变更入口）
internal/db/repository/ 全部数据访问：SQLite 实现 + Store；订单按职责拆小文件（order_query.go / order_create.go / order_state.go / order_stats.go / order_log.go）
internal/models/        模型、共享类型（ProductView/AdminRow/…）与领域错误
internal/payment/       支付网关抽象：interface.go（Gateway）+ bepusdt.go（BEPusdt 实现）
internal/notify/        通知（事件模板 / 邮件 / Telegram / Webhook）
internal/jobs/          任务总线 + 调度器 + order_expire / email_retry / cleanup / backup
internal/logging/       zap 日志（app / payment / security）
internal/security/      TOTP 与 AES-GCM 加密
internal/version/       构建版本信息（-ldflags 注入）
internal/config/        配置默认值
internal/testutil/      集成测试设施：临时 SQLite 测试库 + MockGateway + NotifyRecorder
internal/integration/   订单集成测试（支付回调 / 重复回调 / 取消 / 超时）
admin-ui/               Element Plus 后台（src/api|views|stores|hooks|utils|components）
storefront/             Nuxt 3 SSR 前台
logs/                   运行日志（app.log / payment.log / security.log）
AGENTS.md               工程约定（分层 / 小文件 / 接口化 / 迁移 / 密钥 / 测试）
```

---

## 开发

### 前置要求

- Go 1.25+
- Node.js 18+ / npm
- 一个 BEpusdt 实例（或接入其他 `Gateway` 实现）

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

### 构建与校验

```bash
# 后台静态资源 → internal/api/admin-ui
cd admin-ui && npm install && npm run build && cd ..

# 前台 SSR 产物 → storefront/.output
cd storefront && npm install && npm run build && cd ..

# 单二进制（内嵌后台），可带版本信息
go build -ldflags "-X shop/internal/version.Version=0.1.0 -X shop/internal/version.Commit=$(git rev-parse --short HEAD)" -o shop ./cmd/shop
./shop

# 后台代码质量
cd admin-ui && npm run lint && npm run format
```

> `internal/api/admin-ui` 是后台构建产物，已被 `.gitignore` 忽略，不提交。

### 代码规范（详见 AGENTS.md）

- **service 小文件原则**：按职责拆分（如 `order_create.go` / `order_cancel.go` / `order_deliver.go`），单文件建议不超过 300 行；
- **repository 小文件原则**：订单仓储按职责拆分（query / create / state / stats / log），同样建议单文件不超过 300 行；
- **repository 接口化**：service 只依赖接口，不依赖具体 SQLite；共享类型/领域错误放 `internal/models`；
- 新增 schema 变更必须新增编号 .sql 迁移；敏感配置一律走 `secrets` 表加密存储；
- API 变更必须同步更新 `internal/api/api_docs/openapi.json`（yaml 由 json 生成）；
- 支付/通知相关改动必须跑集成测试；备份逻辑必须带 `integrity_check` 校验；
- 改动同步更新测试与中英文 README。

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

安装期变量：`DOMAIN`（必填）、`EMAIL`、`BRANCH`、`SKIP_SSL=1`（纯 http）、`BUILD_ARTIFACT`、`SHOP_USER`。

> 运行时配置（站点地址、支付、通知等）在 `/setup` 初始化与后台写入数据库，应用不读取任何环境变量。项目不依赖 Docker。

### 构建部署（build-release.sh）

```bash
bash build-release.sh /tmp/liteshop-release.tgz   # shop 二进制（自动注入 git tag/commit/date）+ storefront/.output
```

### 手动部署

- Go：systemd `cardshop`，运行 `/opt/cardshop/shop`，监听 8080
- 前台：systemd `liteshop-storefront`，运行 `/opt/liteshop-storefront/server/index.mjs`，监听 3001
- Caddy：API/后台/回调分流到 Go，其余到 Nuxt

---

## 测试与 CI

- 单元/集成：`go test ./...`（迁移、签名验签、密码哈希、状态机、优惠券/免费订单、会话、登录锁定、任务总线、调度器、worker panic 隔离、备份校验、邮件重试、健康检查）
- **mock 测试**：service 依赖接口，可脱离数据库用内存 stub（如设置保存/校验）
- **集成测试**（`internal/integration` + `internal/testutil`）：
  - 临时 SQLite 测试库（完整迁移 + 造数）
  - `MockGateway`（记录创建/取消调用）与 `NotifyRecorder`（收集通知回调）
  - 覆盖：支付回调发卡、**重复回调幂等**（不重复发卡/通知）、取消订单释放库存并关闭网关交易、超时订单自动过期、真实 HTTP 回调路由（含 MD5 验签 / status=3 网关 stub / 错误签名拒绝）
- CI（`.github/workflows/ci.yml`）：Go `vet` / `build` / `test` + 后台/前台构建

---

## 缓存与 SEO

| 路径 | Cache-Control |
| --- | --- |
| `/_nuxt/*`、`/assets/*`、`/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`、`/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/`、`/api/*`、`/admin/*`、`/order*`、`/product*`、`/page*`、`/setup`、`/health` | `no-store` + `X-Robots-Tag: noindex` |

- 动态页面不缓存；站点源取自数据库 `public_base_url`，不依赖 Host/环境变量。

---

## 可观测性

- 日志（zap）：`logs/app.log` / `logs/payment.log` / `logs/security.log`，50MB 轮转保留 7 份
- 健康检查 `GET /health`：返回应用名、版本、构建标识、运行时长与组件状态（`database` / `payment`），DB 故障返回 503
- 启动横幅：启动时输出 `LiteShop vX.Y.Z (commit, date)` 及 database / payment / listen / admin / notify 信息
- 版本号由 `internal/version` 统一管理，构建时经 `-ldflags` 注入（build-release.sh 自动带 git tag / commit / date）
- 后台 `/api/v1/admin/version` 返回版本与构建信息
- 请求日志：`app.log` 每请求一行（request_id / method / path / status / duration_ms）；支付日志带 request_id / order_no / trace_id

---

## API 文档

- 地址：`/docs`（别名 `/swagger`），**仅管理员登录后可见**，避免公开暴露完整接口面
- 规范文件：`/docs/openapi.json` 与 `/docs/openapi.yaml`（OpenAPI 3.0，覆盖前台 / 后台 / 支付回调全部端点）
- 使用：Swagger UI / Postman 等直接导入上述 URL；公开端点无需认证，管理端点需会话 Cookie
- 维护：接口变更必须同步更新 `internal/api/api_docs/openapi.json`（yaml 由 json 生成）

---

## 安全说明

- 密码 PBKDF2-SHA256（10 万次）+ 恒定时间；登录时序均摊；**失败 5 次锁 10 分钟**
- TOTP 2FA 密钥 AES-GCM 加密；敏感配置（支付/邮件/通知/维护密码）AES 加密存储于 `secrets` 表
- 订单查看令牌只经邮件下发；会话持久化 + 删号/登出/恢复/重置即时吊销
- 状态机原子化（发卡/取消/过期单事务）；100% 券订单直接完成
- SQL 全参数化；markdown 关闭 HTML；CSV 公式注入防护；CSP/HSTS/安全头
- 配置备份不含密钥；HTTP 服务显式超时；异步任务不阻塞支付回调；worker panic 隔离
- security.log 记录登录成功/失败/锁定与 TOTP 验证

---

## 许可证

MIT，见 [LICENSE](LICENSE)。
