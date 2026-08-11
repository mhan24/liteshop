# LiteShop

English: [README.en.md](README.en.md) ｜ 更新日志：[CHANGELOG.md](CHANGELOG.md) ｜ 工程约定：[AGENTS.md](AGENTS.md)

**LiteShop** —— 基于 **Go + SQLite** 的自动发卡系统（优惠码 / 卡密），对接 [BEpusdt](https://github.com/v03413/BEpusdt) 与 [HashPay](https://github.com/TGDash/HashPay) 加密货币收单网关（**双网关并存，买家自主选择**）。买家前台为 Nuxt 3 SSR，管理后台为 Vue 3 SPA，两者均使用 **Tailwind CSS 4 + shadcn-vue** 组件体系；Go 提供 JSON API、支付回调、内嵌后台与后台任务。

> 版本沿革：v0.1.0 代号**地球（Earth）**；v0.2.0 代号**月球（Moon）**（工程化重构）；v0.3.0 前后台 UI 迁移 shadcn-vue。详见 [CHANGELOG](CHANGELOG.md)。
>
> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 遵循 GPL-3.0，本项目采用 MIT 协议。

---

## 功能总览

### 前台（Nuxt 3 SSR + shadcn-vue）

- 商品列表：分类 / 置顶 / 排序 / 搜索 / 价格筛选，支持图片与列表两种视图
- 商品详情 + Cloudflare Turnstile 人机验证，FAQ 手风琴、批发阶梯价
- 下单：**可选支付方式（BEpusdt 网络支付 / HashPay 加密支付）**，新标签页打开收银台，原页跳转订单详情
- 订单详情：待支付自动轮询、支付成功自动显示卡密、支持取消订单（同步关闭网关交易）
- 订单查询：仅邮箱找回 + “发送查看链接到邮箱”（模糊响应，不泄露邮箱是否下过单）
- 访问凭证：所有订单凭随邮件发送的**查看令牌**访问卡密/取消；令牌只发往登记邮箱
- 隐私 / 服务条款 / 首次初始化 `/setup`
- SEO：canonical / OG / JSON-LD / sitemap / robots / favicon

### 后台（Vue 3 SPA + shadcn-vue）

- 仪表盘：商品 / 卡密 / 订单统计、销售趋势与商品占比、毛利（成本快照）、低库存告警
- 商品：新建 / 编辑 / 分类 / 置顶 / 排序 / 价格 / 上下架 / FAQ / 批发阶梯价 / 限购
- 卡密：导入（去重）/ 删除 / 导出
- 订单：查看 / CSV 导出 / 标记过期 / 取消 / 改状态 / 重发 / 批量重发 / 补发
- 优惠券：固定 / 百分比、最低金额、使用次数、适用商品、有效期；**100% 券订单自动完成并直接发卡**
- 支付：**双网关并存（可分别启用/停用）** + 各网关独立配置（Base URL / Token / 商户私钥 / 收款类型 / 货币 / 超时 / 回调地址，修改即时生效）
- 通知：SMTP / Telegram / Webhook + **事件模板** + 管理员通知邮箱 + 测试按钮
- 站点：标题 / 公告 / 公开地址 / Logo / Favicon / SEO / 链接 / 版权 / 隐私 / 条款 / Turnstile
- 维护模式：开关 + 提示文案 + 解锁密码（哈希 + 加密存储）
- 账号：改用户名 / 改密码；TOTP 二次验证（密钥 AES 加密）
- 安全：管理员 RBAC + 审计日志
- 系统：配置备份 / 恢复（不含密钥）/ 清空并重新初始化 / 后台任务状态

### 后端（Go）

- SQLite 存储（纯 Go，无 CGO）；无应用级环境变量，**全部配置在初始化与管理后台写入数据库**
- 配置系统：`settings`（系统配置）+ `secrets`（敏感配置 AES-GCM 加密）+ `settings_version`（配置结构升级）
- 分层：`api`（handler）→ `service`（业务）→ `db/repository`（数据）→ `db/schema`（迁移）
- 领域事件：`internal/events` 类型化事件 + 版本化载荷 + **Fanout 消费者隔离**
- **Outbox 模式**：支付成功/发货事件与订单状态**同事务**写入 `outbox_events`，worker 发布；连续失败 5 次进 `dead_events`；已发布事件 30 天清理
- 幂等台账：支付回调以网关交易号唯一键登记 `processed_events`（与状态迁移同事务）
- 支付抽象：业务只依赖 `payment.Gateway` 接口，内置 BEpusdt 与 HashPay 两个实现，换网关不改业务
- 任务系统：goroutine + channel + ticker；panic 隔离、启动补偿、`job_runs` 执行记录
- 后台任务：订单超时关闭、失败邮件重试、清理、每日备份（`VACUUM INTO` + `integrity_check` 校验）
- 日志（zap）：app / payment / security 三通道，50MB 轮转保留 7 份；request_id / order_id / trace_id 关联
- 迁移体系：编号 .sql 迁移（只执行一次）；配置结构升级走 `settings_version`
- 管理员安全：PBKDF2-SHA256、TOTP 2FA、登录失败锁定（IP+用户名）、登录时序均摊
- 可观测性：组件级健康检查 `/health`、版本注入、结构化启动横幅
- API 文档：`/docs`（OpenAPI 3.0，json + yaml，`/swagger` 别名），仅管理员可见

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
| 前台 SSR | Nuxt 3 + Tailwind CSS 4 + shadcn-vue | 3001 |
| 后台 SPA | Vue 3 + Vite + TS + Tailwind CSS 4 + shadcn-vue + Pinia | 内嵌进 Go |

### 分层

```
HTTP handler (internal/api)
    → service (internal/service)
        → 接口（OrderRepository / ProductRepository / KeyRepository / SettingsStore / AdminStore）
        → internal/db/repository（SQLite 实现）+ internal/db/schema（迁移）
```

- handler 只做 HTTP 适配（解析 / 响应 / 限流 / Turnstile / Cookie / 鉴权 / Origin 同源校验），不直连数据库、不调支付网关、不发送通知；
- 业务全部经 `service`，**service 只依赖接口**，不绑定具体 SQLite，测试可用内存 mock；共享类型与领域错误在 `internal/models`；
- `internal/db/repository` 集中全部 SQL；`internal/db/schema` 是唯一 schema 变更入口；
- 支付走 `payment.Gateway` 接口；通知经 `internal/notify` + 任务总线异步执行；关键事件走 Outbox；后台任务经 `internal/jobs` 调度。

### UI 组件规范

- `components.json`（前后台各一份）是 shadcn-vue 的组件配置（样式 reka-nova、别名、CSS 入口）；
- `src/components/ui/`（后台）与 `components/ui/`（前台）**只放 shadcn-vue 生成组件**，用 `npx shadcn-vue@latest add <component>` 增删，不手改核心文件；
- 业务自研组件放后台 `src/components/`（Modal / DataTable / FormField / PaginationBar / Toast / Confirm / PageCard / SideNav 等）与前台 `components/`（SiteHeader / SiteFooter 等）；
- 主题为 shadcn-vue 默认 neutral 变量（内联在 `assets/css/main.css` / `assets/css/main.css`），**无独立配色文件**。

---

## 支付流程

```
下单（用户选择网关）→ 锁定卡密（原子事务）→ 创建交易（payment.Gateway[所选网关]）→ 新标签页打开收银台
  → 原页跳订单详情页（自动轮询）
→ 用户转账 → 网关回调（BEpusdt MD5 验签 / HashPay RSA 解密信封）→ 验签 + processed_events 幂等 → 订单 paid
  → 同事务写 outbox → worker 发卡通知（邮件/Telegram/Webhook）→ 前台显示卡密
```

- 取消 / 过期：释放库存 + 关闭网关交易（HashPay 协议无商户取消接口，主动查询 + 到期回调兜底，迟到回调不会误发货）；
- 事务边界：下单 = 单事务（建单 + 锁卡 + 扣库存），失败原子释放卡密；支付成功 = 单事务（paid + 发卡），**COMMIT 后才发布事件/发邮件**；
- 双网关并存：订单记录所选网关，`processed_events` 幂等键带网关前缀，回调路由各自独立（`/notify/bepusdt`、`/notify/hashpay`）；
- **payment.log** 记录每次创建/回调：订单号、金额、交易 ID、回调时间、结果 + request_id / trace_id。

---

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前台 | Nuxt 3 SSR + Tailwind CSS 4 + shadcn-vue |
| 后台 | Vue 3 + Vite + TypeScript + Tailwind CSS 4 + shadcn-vue + Pinia + VueUse + @lucide/vue |
| UI 组件管理 | shadcn-vue CLI（`components.json`，reka-ui 驱动） |
| 后台质量 | ESLint（flat config + typescript-eslint + eslint-plugin-vue）+ Prettier |
| API 类型 | OpenAPI → TS 自动生成（`admin-ui npm run gen:api` → `src/api/types.ts`） |
| 后端 | Go 1.25.12+（govulncheck 全绿） |
| 数据库 | SQLite (modernc.org/sqlite)，迁移 + 接口化仓储分层 |
| 日志 | go.uber.org/zap + lumberjack |
| 任务 | goroutine + channel + ticker（无 MQ），Outbox 模式 |
| 反向代理 | Caddy |
| 支付 | BEpusdt / HashPay 并存（`payment.Gateway` 接口抽象，前台可选） |
| 人机验证 | Cloudflare Turnstile |

---

## 目录结构

```
cmd/shop/                Go 程序入口
internal/api/            HTTP 路由、JSON API、支付回调、内嵌后台、API 文档（handler 层）
internal/service/        业务逻辑（按领域拆小文件；repository.go 定义依赖接口）
internal/db/             数据库连接层
internal/db/schema/      schema 迁移执行器 + migrations/*.sql（唯一 schema 变更入口）
internal/db/repository/  全部 SQL（SQLite 实现 + Store 接口实现）
internal/db/settings_migrations.go   配置结构升级（settings_version）
internal/models/         模型、共享类型与领域错误
internal/payment/        支付网关抽象：interface.go（Gateway）+ bepusdt.go + hashpay.go
internal/notify/         通知（事件模板 / 邮件 / Telegram / Webhook）
internal/jobs/           任务总线 + 调度器（order_expire / email_retry / outbox_publish / cleanup / backup）
internal/logging/        zap 日志（app / payment / security）+ 关联 ID
internal/security/       TOTP 与 AES-GCM 加密
internal/events/         类型化领域事件 + Fanout 消费者隔离 + 版本化载荷
internal/version/        构建版本信息（-ldflags 注入）
internal/config/         配置默认值
internal/testutil/       集成测试设施（临时 SQLite + MockGateway + NotifyRecorder）
internal/integration/    订单集成测试（回调 / 重复回调 / 取消 / 超时 / 并发压测）

admin-ui/                Vue 3 + Vite + shadcn-vue 后台
  components.json        shadcn-vue 组件配置
  src/components/        自研组件（Modal / DataTable / FormField / PaginationBar / Toast / Confirm / PageCard / SideNav）
  src/components/ui/     shadcn-vue 生成组件（按需增删）
  src/views/             15 个后台页面
  src/api/               API 封装 + 自动生成的 types.ts
  src/stores|hooks|utils|i18n

storefront/              Nuxt 3 SSR 前台
  components.json        shadcn-vue 组件配置
  components/ui/         shadcn-vue 生成组件（仅保留使用到的）
  components/            SiteHeader / SiteFooter 等业务组件
  pages|layouts|composables|server|public
  lib/utils.ts           cn() 工具（shadcn 依赖）

data/                    运行数据（SQLite 与备份，gitignore）
logs/                    运行日志（gitignore）
AGENTS.md                工程约定（分层 / 小文件 / 接口化 / 迁移 / 密钥 / 测试 / 安全基线）
```

> `internal/api/admin-ui` 是后台构建产物（内嵌进 Go 二进制），`storefront/.output` 是前台 SSR 产物，均已被 `.gitignore` 忽略，不提交。

---

## 开发

### 前置要求

- Go 1.25.12+（govulncheck 基线）
- Node.js 18+ / npm
- 一个 BEpusdt 实例 或 一个 HashPay 实例（Cloudflare Workers 上运行，商户后台生成 RSA 密钥对）

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
# 后台静态资源 → internal/api/admin-ui（内嵌进 Go 二进制）
cd admin-ui && npm install && npm run build && cd ..

# 前台 SSR 产物 → storefront/.output
cd storefront && npm install && npm run build && cd ..

# 单二进制（内嵌后台），可带版本信息
go build -ldflags "-X shop/internal/version.Version=0.3.0 -X shop/internal/version.Commit=$(git rev-parse --short HEAD)" -o shop ./cmd/shop
./shop

# 依赖安全基线
govulncheck ./...
cd admin-ui && npm audit --omit=dev

# 后台代码质量
cd admin-ui && npm run lint && npm run format
```

### 代码规范（详见 AGENTS.md）

- service / repository 小文件原则：按职责拆分，单文件建议不超过 300 行；
- repository 接口化：service 只依赖接口；共享类型/领域错误放 `internal/models`；
- 新增 schema 变更必须新增编号 .sql 迁移；配置结构升级走 `settings_version`；敏感配置一律走 `secrets` 表加密存储；
- 关键领域事件必须走 Outbox（与状态同事务）；外部事件必须幂等（`processed_events`）；
- API 变更必须同步 OpenAPI 并 `npm run gen:api`；备份必须带 `integrity_check` 校验与恢复演练；
- shadcn 组件用 CLI 管理，自研组件与生成组件分目录存放；主题不引入独立配色文件；
- 安全基线：Go ≥1.25.12 + govulncheck；登录锁定含 IP；管理接口 Origin 校验；改动同步测试与中英文 README。

---

## 部署（服务器）

### 发布流程（tag → release）

打 `v*` tag 即触发 CI Release：构建 admin-ui / storefront → Go 二进制（版本号取自 tag）→ 打包 `liteshop-release.tgz` + `SHA256` 校验和 → 自动创建 GitHub Release：

```bash
git tag v0.3.0 && git push origin v0.3.0
```

产物可直接用于 `install.sh` 的 `BUILD_ARTIFACT` 快速部署。

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

> 运行时配置在 `/setup` 初始化与后台写入数据库，应用不读取任何环境变量。项目不依赖 Docker。

### 接入 HashPay

1. 部署 [HashPay](https://github.com/TGDash/HashPay) 到 Cloudflare Workers 并完成后台初始化；
2. 在 HashPay 后台创建 **Native API** 商户，保存只显示一次的**私钥**，并把商户 Callback 地址填为 LiteShop 的 HashPay 回调地址（后台支付页可查看，默认 `https://你的域名/notify/hashpay`）；
3. LiteShop 后台「支付设置」勾选启用 **HashPay**（可与 BEpusdt 同时启用），填入站点地址、商户 ID、私钥与货币（默认 USD）并保存；
4. 启用多个网关时前台展示**支付方式选择**：选 BEpusdt 显示网络选项（TRC20/ERC20 等），选 HashPay 由托管收银台选择网络/资产。

> 私钥仅创建商户时显示一次，后台保存后加密写入 `secrets` 表，留空表示保持当前密钥。

### 构建部署（build-release.sh）

```bash
bash build-release.sh /tmp/liteshop-release.tgz   # shop 二进制（注入 git tag/commit/date）+ storefront/.output
```

### 手动部署

- Go：systemd `cardshop`，运行 `/opt/cardshop/shop`，监听 8080
- 前台：systemd `liteshop-storefront`，运行 `/opt/liteshop-storefront/server/index.mjs`，监听 3001
- Caddy：API/后台/回调分流到 Go，其余到 Nuxt（前台含 CSP）

---

## 测试与 CI

- 单元/集成：`go test ./...`（迁移、验签、密码哈希、状态机、优惠券、会话、登录锁定、任务总线、备份校验、健康检查、安全头、并发压测、恢复演练、旧库升级、事件/幂等/死信）
- **mock 测试**：service 依赖接口，可脱离数据库用内存 stub
- **集成测试**（`internal/integration` + `internal/testutil`）：临时 SQLite 测试库 + `MockGateway` / `NotifyRecorder`，覆盖双网关回调发卡、**重复回调幂等**、取消/超时释放库存、真实 HTTP 回调路由、**100 并发抢 1 卡**、Outbox 死信、备份恢复、旧库升级
- **性能基准**：`go test -bench=. ./internal/integration/`
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
- SSR 缓存策略：动态页面与商品列表保持 `no-store`；ISR / edge cache 暂不实施。

---

## 可观测性

- 日志（zap）：`logs/app.log` / `logs/payment.log` / `logs/security.log`，50MB 轮转保留 7 份
- 健康检查 `GET /health`：应用名、版本、构建标识、`config_version`、运行时长与组件状态
- 健康指标：`database`（status / size_bytes / migration_version / last_backup / integrity）+ `jobs`（mail_queue_size / last_success）
- 版本号由 `internal/version` 统一管理，构建时经 `-ldflags` 注入
- 后台 `/api/v1/admin/version` 返回版本与构建信息；`/api/v1/admin/jobs` 返回任务执行记录与队列/死信指标
- 关联 ID：每请求 `request_id`；支付日志带 request_id / order_no / trace_id
- 安全头回归测试：`internal/api/security_test.go` 固化 nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / admin CSP / HSTS / 会话 Cookie Secure；站点位于 Cloudflare 之后，后台 CSP 放行边缘注入脚本与 Web Analytics beacon（与前台策略一致），前台 CSP 放行 Turnstile

---

## API 文档

- 地址：`/docs`（别名 `/swagger`），**仅管理员登录后可见**
- 规范文件：`internal/api/api_docs/openapi.json` 与 `openapi.yaml`（OpenAPI 3.0，覆盖前台 / 后台 / 支付回调全部端点；内嵌进二进制）
- 前端类型：`admin-ui/src/api/types.ts` 由规范自动生成（`npm run gen:api`，CI diff 校验）
- 维护：接口变更必须同步更新 `internal/api/api_docs/openapi.json`（yaml 与 TS 类型由 json 生成）

---

## 安全说明

- 密码 PBKDF2-SHA256（10 万次）+ 恒定时间；登录时序均摊；**失败 5 次锁 10 分钟（IP+用户名）**
- TOTP 2FA 密钥 AES-GCM 加密；敏感配置（支付/邮件/通知/维护密码）AES 加密存储于 `secrets` 表
- 订单查看令牌只经邮件下发；会话持久化 + 删号/登出/恢复/重置即时吊销
- 状态机原子化（发卡/取消/过期单事务）；并发库存 `_txlock=immediate` + 原子锁卡
- SQL 全参数化；markdown 关闭 HTML + 链接协议白名单；CSV 公式注入防护；CSP/HSTS/安全头
- 配置备份不含密钥；HTTP 服务显式超时；异步任务不阻塞支付回调；worker/事件消费者 panic 隔离
- 限流信任边界：仅对端为 Cloudflare 边缘 IP 才采信 `CF-Connecting-IP`；管理接口非幂等请求校验 Origin 同源
- security.log 记录登录成功/失败/锁定与 TOTP 验证
- 会话主密钥（`session_secret`）明文存 `settings`：请严格保护数据库访问权限；服务器本地密钥文件已列入 `settings_version` v2 规划

---

## 版本与许可证

- v0.3.0：前后台 UI 迁移 shadcn-vue；v0.2.0 代号**月球（Moon）**；v0.1.0 代号**地球（Earth）**；完整更新日志见 [CHANGELOG.md](CHANGELOG.md)
- MIT，见 [LICENSE](LICENSE)。
