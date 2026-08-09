# LiteShop

English: [README.en.md](README.en.md) ｜ 更新日志：[CHANGELOG.md](CHANGELOG.md)

**LiteShop v0.2.0（代号：月球 Moon）** —— 基于 **Go + SQLite** 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。买家前台使用 Nuxt 3 SSR + Tailwind；管理后台使用 Vue 3 + TypeScript + Element Plus + Pinia；Go 提供 JSON API、支付回调、内嵌后台与后台任务。

> 版本沿革：v0.1.0 代号**地球（Earth）**；v0.2.0 代号**月球（Moon）**——分层、抽象、可观测性与稳定性全面升级，详见 [CHANGELOG](CHANGELOG.md)。
>
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
- 支付：网关 Base URL / Token / 收款类型 / 超时 / 回调地址（修改即时生效）
- 通知：SMTP / Telegram / Webhook + **事件模板**（订单创建 / 付款成功 / 发货 / 库存不足 / 系统异常）+ 管理员通知邮箱 + 测试按钮
- 站点：标题 / 公告 / **公开地址** / Logo / Favicon / SEO / 链接 / 版权 / 隐私 / 条款 / Turnstile
- 维护模式：开关 + 提示文案 + 解锁密码（哈希 + 加密存储）
- 账号：改用户名 / 改密码
- 安全：TOTP 二次验证（Google Authenticator，密钥 AES 加密）、管理员 RBAC + 审计日志
- 系统：配置备份 / 恢复（不含密钥）/ 清空并重新初始化 / **后台任务状态**（每个任务最后执行结果 + 邮件队列积压 + 死信数）

### 后端（Go）

- SQLite 存储（纯 Go，无 CGO）；无应用级环境变量，**全部配置在初始化与管理后台写入数据库**
- 配置系统：`settings`（系统配置）+ `secrets`（敏感配置 AES-GCM 加密）+ `settings_version`（配置结构升级版本）
- 分层：api（handler）→ service（业务）→ db/repository（数据）→ db/schema（schema 演进）；payment / notify / jobs / logging 按职责独立
- 领域事件：`internal/events` 类型化事件（OrderPaid / OrderExpired / DeliveryFailed / LowStock …）+ 版本化载荷 + **Fanout 消费者隔离**，service 只发布事件、不散落 `bus.Publish`
- **Outbox 模式**：支付成功/发货事件与订单状态**同事务**写入 `outbox_events`，worker 发布；连续失败 5 次进 `dead_events`；已发布事件 30 天清理
- 幂等台账：支付回调以网关交易号唯一键登记 `processed_events`（与状态迁移同事务），重复通知只处理一次
- 支付抽象：订单业务只依赖 `payment.Gateway` 接口，当前实现为 BEpusdt，换网关不改业务
- 任务系统：goroutine + channel（邮件 / Telegram / Webhook）+ ticker；panic 隔离、启动补偿、`job_runs` 执行记录
- 后台任务：订单超时自动关闭、失败邮件重试、会话/日志/outbox/队列清理、每日数据库备份（含完整性校验）
- 日志（zap）：app / payment / security 三通道，50MB 轮转保留 7 份；request_id / order_id / trace_id 关联
- 迁移体系：编号 .sql 迁移（`internal/db/schema/migrations/`），只执行一次并记录
- 管理员安全：PBKDF2-SHA256、TOTP 2FA、**登录失败 5 次锁定 10 分钟（IP+用户名）**、登录时序均摊防枚举
- 安全：RBAC、审计日志（三索引）、限流分级、Turnstile、CSP、HSTS、安全响应头、CSV 注入防护、SQL 全参数化
- 可观测性：组件级健康检查 `/health`（database 指标 + jobs 指标）、版本注入、结构化启动横幅
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
| Go API | Go 1.25.12+ + SQLite (modernc) | 8080 |
| 前台 SSR | Nuxt 3 + Tailwind | 3001 |
| 后台 SPA | Vue 3 + TS + Element Plus + Pinia | 内嵌进 Go |

### 分层

```
HTTP handler (internal/api)
    → service (internal/service)
        → 接口（OrderRepository / ProductRepository / KeyRepository / SettingsStore / AdminStore）
        → internal/db/repository（SQLite 实现）+ internal/db/schema（迁移）
```

- handler 只做请求解析/响应与 HTTP 安全（Turnstile / 限流 / Cookie / 鉴权中间件 / Origin 同源校验），不直连数据库、不调支付网关、不发送通知；
- 业务全部经 `service`（Order / Product / Admin / Settings / Notify / Stats），**service 只依赖接口**，不绑定具体 SQLite，测试可用内存 mock；共享类型与领域错误在 `internal/models`；
- `internal/db/repository` 集中全部 SQL（Order / Product / Key / Coupon / Admin / Session / Setting / Secret / MailQueue / Log），另有 `Store` 把配置/管理员/会话/审计收敛为接口实现；
- 支付走 `payment.Gateway` 接口（BEpusdt 实现），业务不绑定具体网关；
- 通知经 `internal/notify` + 任务总线异步执行；关键事件走 Outbox；后台任务经 `internal/jobs` 调度。

### 数据库迁移（Laravel 风格）

- 迁移文件 `internal/db/schema/migrations/`，编号命名（`001_init.sql`、`002_...`、…），按序执行；
- 每个迁移记录在 `schema_migrations`，**只执行一次**，重启不重复；
- 规范：**新增 schema 变更必须新增编号 .sql 文件**，禁止启动时"检查表 / 自动补列"；
- 仅 SQLite 无法纯 SQL 表达的存量升级（条件 ALTER / 表重建 / 数据迁移）使用 Go 迁移步骤；
- 配置结构升级走 `settings_version`（`internal/db/settings_migrations.go` 编号步骤）。

### 任务与后台任务

- **任务总线**（`internal/jobs/bus.go`）：goroutine + channel，通知（邮件/Telegram/Webhook）异步执行；
- **后台任务**（`internal/jobs/scheduler.go`）：Go ticker 调度
  - `order_expire`：每 5 分钟关闭超时未支付订单、释放卡密（不依赖用户访问）
  - `email_retry`：失败邮件入 `mail_queue`，指数退避重试（最多 5 次）
  - `outbox_publish`：每 1 秒发布 outbox 事件（崩溃重启自动补发）
  - `cleanup`：过期会话 / 180 天日志 / outbox 30 天 / 邮件队列 / job_runs 7 天 / 内存状态清理
  - `backup`：每日 `VACUUM INTO` 一致性快照 + **只读打开执行 `integrity_check` 校验**（校验失败自动删除坏文件），保留最近 7 份
- 健壮性：worker/调度任务 panic 隔离；`order_expire` / `email_retry` / `outbox_publish` / `cleanup` 启动后立即执行一次（进程崩溃后的补偿清理）；每次执行写入 `job_runs`

---

## 支付流程

```
下单 → 锁定卡密（原子事务）→ 创建交易（payment.Gateway）→ 新标签页打开收银台
  → 原页跳订单详情页（自动轮询）
  → 用户转账 → 网关回调（路径可运行时修改）→ 验签 + processed_events 幂等 → 订单 paid
  → 同事务写 outbox → worker 发卡通知（邮件/Telegram/Webhook）→ 前台显示卡密
```

- 取消 / 过期：释放库存 + 调用网关 `cancel-transaction` 关闭交易（原子事务）；
- 事务边界：下单 = 单事务（建单 + 锁卡 + 扣库存），失败原子置 `payment_failed` 并释放卡密；支付成功 = 单事务（paid + 发卡），**COMMIT 后才发布事件/发邮件**；
- 换网关（其他 USDT / Stripe / PayPal）只需新增一个实现 `Gateway` 的适配器；
- **payment.log** 记录每次创建/回调：订单号、金额、交易 ID、回调时间、结果 + request_id / trace_id。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前台 | Nuxt 3 SSR + Tailwind CSS |
| 后台 | Vue 3 + Vite + TypeScript + Element Plus + Pinia + VueUse + unplugin-auto-import |
| 后台质量 | ESLint（flat config + typescript-eslint + eslint-plugin-vue）+ Prettier |
| API 类型 | OpenAPI → TS 自动生成（`admin-ui npm run gen:api` → `src/api/types.ts`） |
| 后端 | Go 1.25.12+（govulncheck 全绿） |
| 数据库 | SQLite (modernc.org/sqlite)，迁移 + 接口化仓储分层 |
| 日志 | go.uber.org/zap + lumberjack |
| 任务 | goroutine + channel + ticker（无 MQ），Outbox 模式 |
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
internal/db/repository/ 全部数据访问：SQLite 实现 + Store（settings/secrets/admin/session/audit）
internal/db/settings_migrations.go  配置结构升级（settings_version）
internal/models/        模型、共享类型（ProductView/AdminRow/…）与领域错误
internal/payment/       支付网关抽象：interface.go（Gateway）+ bepusdt.go（BEPusdt 实现）
internal/notify/        通知（事件模板 / 邮件 / Telegram / Webhook）
internal/jobs/          任务总线 + 调度器 + order_expire / email_retry / outbox_publish / cleanup / backup
internal/logging/       zap 日志（app / payment / security）+ 关联 ID
internal/security/      TOTP 与 AES-GCM 加密
internal/events/        类型化领域事件 + Fanout 消费者隔离 + 版本化载荷
internal/version/       构建版本信息（-ldflags 注入）
internal/config/        配置默认值
internal/testutil/      集成测试设施：临时 SQLite 测试库 + MockGateway + NotifyRecorder
internal/integration/   订单集成测试（支付回调 / 重复回调 / 取消 / 超时 / 并发压测）
admin-ui/               Element Plus 后台（src/api|views|stores|hooks|utils|components）
storefront/             Nuxt 3 SSR 前台
logs/                   运行日志（app.log / payment.log / security.log）
CHANGELOG.md            更新日志（v0.1 地球 / v0.2 月球）
AGENTS.md               工程约定（分层 / 小文件 / 接口化 / 迁移 / 密钥 / 测试 / 安全基线）
```

---

## 开发

### 前置要求

- Go 1.25.12+（govulncheck 基线）
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
go build -ldflags "-X shop/internal/version.Version=0.2.0 -X shop/internal/version.Commit=$(git rev-parse --short HEAD)" -o shop ./cmd/shop
./shop

# 依赖安全基线
govulncheck ./...
cd admin-ui && npm audit --omit=dev

# 后台代码质量
cd admin-ui && npm run lint && npm run format
```

> `internal/api/admin-ui` 是后台构建产物，已被 `.gitignore` 忽略，不提交。

### 代码规范（详见 AGENTS.md）

- **service / repository 小文件原则**：按职责拆分，单文件建议不超过 300 行；
- **repository 接口化**：service 只依赖接口；共享类型/领域错误放 `internal/models`；
- 新增 schema 变更必须新增编号 .sql 迁移；配置结构升级走 `settings_version`；敏感配置一律走 `secrets` 表加密存储；
- 关键领域事件必须走 Outbox（与状态同事务）；外部事件必须幂等（`processed_events`）；
- API 变更必须同步 OpenAPI 并 `npm run gen:api`；备份必须带 `integrity_check` 校验与恢复演练；
- 安全基线：Go ≥1.25.12 + govulncheck；登录锁定含 IP；管理接口 Origin 校验；改动同步测试与中英文 README。

---

## 部署（服务器）

### 发布流程（tag → release）

打 `v*` tag 即触发 CI Release：构建 admin-ui / storefront → Go 二进制（版本号取自 tag，代号见 CHANGELOG）→ 打包 `liteshop-release.tgz` + `SHA256` 校验和 → 自动创建 GitHub Release 并附产物：

```bash
git tag v0.2.0 && git push origin v0.2.0
```

产物可直接用于 `install.sh` 的 `BUILD_ARTIFACT` 快速部署（校验和防篡改）。

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
- Caddy：API/后台/回调分流到 Go，其余到 Nuxt（前台含 CSP）

---

## 测试与 CI

- 单元/集成：`go test ./...`（迁移、签名验签、密码哈希、状态机、优惠券/免费订单、会话、登录锁定、任务总线、调度器、worker panic 隔离、备份校验、邮件重试、健康检查、安全头、并发压测、恢复演练、版本兼容升级、事件/幂等/死信）
- **mock 测试**：service 依赖接口，可脱离数据库用内存 stub
- **集成测试**（`internal/integration` + `internal/testutil`）：
  - 临时 SQLite 测试库（完整迁移 + 造数）；`MockGateway` / `NotifyRecorder`
  - 覆盖：支付回调发卡、**重复回调幂等**、取消/超时释放库存并关闭网关交易、真实 HTTP 回调路由（验签 / 动态路径 / 错误签名）、**100 并发抢 1 卡**、Outbox 死信、备份恢复演练、旧库升级
- **性能基准**：`go test -bench=. ./internal/integration/`（下单 ~6.4ms / 回调 ~6.8ms / 查询 ~21µs 基线）
- **依赖基线**：`govulncheck ./...` 无漏洞（Go 1.25.12）；`npm audit` 运行时 0 漏洞（admin-ui 仅构建期 js-yaml 告警，不可达）
- CI（`.github/workflows/ci.yml`）：Go `vet` / `build` / `test` + gen:api diff 校验 + 前后台构建

---

## 缓存与 SEO

| 路径 | Cache-Control |
| --- | --- |
| `/_nuxt/*`、`/assets/*`、`/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`、`/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/`、`/api/*`、`/admin/*`、`/order*`、`/product*`、`/page*`、`/setup`、`/health` | `no-store` + `X-Robots-Tag: noindex` |

- 动态页面不缓存；站点源取自数据库 `public_base_url`，不依赖 Host/环境变量；
- SSR 缓存策略：动态页面与商品列表保持 `no-store`（正确）；ISR / edge cache 在高流量时再评估，当前不做。

---

## 可观测性

- 日志（zap）：`logs/app.log` / `logs/payment.log` / `logs/security.log`，50MB 轮转保留 7 份
- 健康检查 `GET /health`：应用名、版本、构建标识、`config_version`、运行时长与组件状态
- 健康指标：`database`（status / size_bytes / migration_version / last_backup / integrity）+ `jobs`（mail_queue_size / last_success）
- 启动横幅：启动时输出 `LiteShop vX.Y.Z (commit, date)` 及 database / payment / listen / admin / notify 信息
- 版本号由 `internal/version` 统一管理，构建时经 `-ldflags` 注入（build-release.sh / Release workflow 自动带 git tag / commit / date）
- 后台 `/api/v1/admin/version` 返回版本、构建信息与 `config_version`；`/api/v1/admin/jobs` 返回任务执行记录与队列/死信指标
- 关联 ID：每请求 `request_id`（响应头 X-Request-ID）；支付日志带 request_id / order_no / trace_id
- 安全头回归测试：`internal/api/security_test.go` 固化 nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / admin CSP / HSTS / 会话 Cookie Secure

---

## API 文档

- 地址：`/docs`（别名 `/swagger`），**仅管理员登录后可见**，避免公开暴露完整接口面
- 规范文件：`/docs/openapi.json` 与 `/docs/openapi.yaml`（OpenAPI 3.0，覆盖前台 / 后台 / 支付回调全部端点）
- 前端类型：`admin-ui/src/api/types.ts` 由规范自动生成（`npm run gen:api`，CI diff 校验，零漂移）
- 使用：Swagger UI / Postman 等直接导入上述 URL；公开端点无需认证，管理端点需会话 Cookie
- 维护：接口变更必须同步更新 `internal/api/api_docs/openapi.json`（yaml 与 TS 类型由 json 生成）

---

## 安全说明

- 密码 PBKDF2-SHA256（10 万次）+ 恒定时间；登录时序均摊；**失败 5 次锁 10 分钟（IP+用户名）**
- TOTP 2FA 密钥 AES-GCM 加密；敏感配置（支付/邮件/通知/维护密码）AES 加密存储于 `secrets` 表
- 订单查看令牌只经邮件下发；会话持久化 + 删号/登出/恢复/重置即时吊销
- 状态机原子化（发卡/取消/过期单事务）；100% 券订单直接完成；并发库存 `_txlock=immediate` + 原子锁卡
- SQL 全参数化；markdown 关闭 HTML + 链接协议白名单；CSV 公式注入防护；CSP/HSTS/安全头
- 配置备份不含密钥；HTTP 服务显式超时；异步任务不阻塞支付回调；worker/事件消费者 panic 隔离
- 限流信任边界：仅对端为 Cloudflare 边缘 IP 才采信 `CF-Connecting-IP`；管理接口非幂等请求校验 Origin 同源
- security.log 记录登录成功/失败/锁定与 TOTP 验证
- 会话主密钥（`session_secret`）明文存 `settings`（无环境变量设计取舍）：请严格保护数据库访问权限；服务器本地密钥文件已列入 `settings_version` v2 规划

---

## 版本与许可证

- v0.2.0 代号**月球（Moon）**；v0.1.0 代号**地球（Earth）**；完整更新日志见 [CHANGELOG.md](CHANGELOG.md)
- MIT，见 [LICENSE](LICENSE)。
