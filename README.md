# LiteShop

一款基于 Go + Nuxt 的自动发卡系统：买家选商品下单 → 加密货币支付 → 支付成功自动发放卡密。支持优惠券、批发价、TOTP 双因素、审计日志、Webhook 等运营与安全能力。

生产实例：<https://shop.3737.de>

## 技术栈

- **后端**：Go 1.25，模块化分层架构（`web → app → modules → platform`），SQLite（modernc 纯 Go 驱动），全部配置存数据库，无 `.env`。
- **前台**：Nuxt 3 SSR（`web/storefront`），Vue 3 + Tailwind CSS，中英双语。
- **后台**：Vue 3 + shadcn-vue + ECharts（`web/admin`），由 Go 二进制内嵌（`-tags production`）。
- **支付**：BEpusdt / HashPay，USDT 与多币种，回调路径可自定义防扫描。
- **部署**：Linux ARM64 + systemd + Caddy TLS，Cloudflare 代理。

## 主要功能

- **商品与卡密**：分类/置顶/排序、批发阶梯价、限购、成本价、库存模糊显示、卡密导入去重、CSV 导出、手动/自动发卡。
- **营销**：优惠券（固定/百分比、最低金额、使用次数、商品范围、有效期）、原子占用与幂等回滚。
- **订单**：状态机（created → waiting_payment → paid → delivered → completed）、支付失败/取消/过期回滚卡密与券、超时补偿清理。
- **安全**：TOTP 2FA（AES-GCM 加密存储 + 旧明文兼容升级）、PBKDF2 密码、RBAC 多管理员、审计日志、登录限流、Webhook HMAC 签名、CSV 公式注入防护。
- **运营**：仪表盘（ECharts 销售曲线/占比）、销售报表 + 成本来源标注（真实快照/估算）、批量重发、配置备份恢复。
- **前台**：商品搜索/筛选、币种/网络选项块、公告弹窗、维护模式、Turnstile 人机验证、自定义 Logo/Favicon。
- **反馈**：写操作以右上角通知框反馈（自动 3.2 秒消失），成功后停留当前页不跳转。

## 项目结构

```
cmd/liteshop/         程序入口
internal/
  app/                HTTP 服务、路由装配、中间件、依赖注入
  modules/            按领域拆分的业务模块（admin/order/product/coupon/inventory/settings/audit）
    */application/    应用用例
    */domain/         领域模型
    */repository/     SQLite 持久化
    */transport/http/ HTTP 处理器
  platform/           支撑层（database/security/config/httpserver/logging/events/outbox/scheduler/mailqueue/backup）
  shared/             跨模块工具（clock/idgen/value）
migrations/           版本化 SQL 迁移（001–027，幂等，含旧库升级）
web/
  admin/              管理端 SPA（Vue 3 + Vite）
  storefront/         前台 Nuxt 3
  embed.go            生产构建内嵌 admin（//go:build production）
  embed_dev.go        开发/测试占位页（//go:build !production）
docs/                 架构说明、订单状态机、迁移路线、运维手册
tests/integration/    端到端集成测试
```

## 快速开始

### 前置依赖
- Go 1.25+（`modernc.org/sqlite` 需要）
- Node 18+（构建前端）

### 构建前端
```bash
cd web/admin && npm install && npm run build        # 产物到 web/admin/dist
cd web/storefront && npm install && npm run build   # 产物到 web/storefront/.output
```

### 构建后端
```bash
# 开发/测试（默认占位 admin，不依赖前端构建）
go build ./cmd/liteshop

# 正式发布（内嵌真实 admin 资源，必须带 production 标签）
go build -tags production -o liteshop ./cmd/liteshop
```
> ⚠️ 正式部署必须使用 `-tags production`，否则管理端只内嵌占位页（提示"管理端资源尚未构建"）。

### 运行
```bash
./liteshop   # 默认监听 :8080，数据库在 ./data/shop.db
```
首次启动自动建表与迁移；若库无管理员，访问 `/setup` 完成初始化。初始化令牌会输出到服务日志，也可通过 `LITESHOP_SETUP_TOKEN` 环境变量固定。后台入口 `/admin`。

## 测试与质量

```bash
make check   # gofmt + vet + lint + 全量测试（前后端）
go test ./...
go test -race ./...
```

迁移系统带版本追踪（`schema_migrations` 表），支持旧库完整升级；`migrations/006–008` 已改为条件 ALTER，幂等可全量重跑。

## 发布

发布构建由 `.github/workflows/release.yml` 负责：构建前后台、注入版本信息、
生成 SHA256 校验值并打包发布文件。生产环境 SQLite 每日自动备份；关键操作
（订单/卡密/券）均为参数化 SQL + 事务边界。

## 文档

- `docs/architecture.md` — 分层架构与组合根
- `docs/order-state-machine.md` — 订单状态机
- `docs/migration-roadmap.md` — 迁移演进
- `docs/runbooks/` — 运维手册

## License

见 [LICENSE](LICENSE)。
