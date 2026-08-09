# LiteShop 工程约定

本文件约束代码结构与变更方式，供开发者与 AI 代理遵循。

## 分层

- `internal/api`：只做 HTTP 适配（解析/响应/限流/Turnstile/Cookie/鉴权中间件），不直连数据库、不调支付网关、不发送通知；
- `internal/service`：全部业务逻辑（Order / Product / Admin / Settings / Notify / Stats）；
- `internal/db/repository`：全部 SQL；`internal/db/schema`：唯一 schema 变更入口；
- service 只依赖接口（`internal/service/repository.go` 的 OrderRepository / ProductRepository / KeyRepository / SettingsStore / AdminStore），不依赖具体 SQLite；测试用内存 mock；
- 仓储共享类型与领域错误放在 `internal/models`（如 ProductView / AdminRow / ErrCouponNotFound / InsufficientError），避免 service ↔ repository 循环依赖；
- 支付只依赖 `internal/payment` 的 `Gateway` 接口，业务不绑定具体网关；
- 通知经 `internal/notify` + 任务总线异步执行；后台任务在 `internal/jobs` 调度。

## service 小文件原则（P0）

- 禁止把单个 service 文件写成几百上千行；
- 按职责拆分为小文件，例如订单：`order_create.go` / `order_cancel.go` / `order_deliver.go` / `order_query.go` / `order_status.go` / `order_coupon.go` / `order_links.go`；
- 单文件建议不超过 300 行；接近上限时先拆文件，再考虑子目录（如 `service/order/`）。

## repository 小文件原则（P0）

- `internal/db/repository` 同样禁止单文件膨胀：订单仓储按职责拆分（`order_query.go` / `order_create.go` / `order_state.go` / `order_stats.go` / `order_log.go`）；
- 单文件建议不超过 300 行；订单/商品逻辑只会越来越复杂（创建、锁库存、支付、取消、过期、发货、重发），接近上限时先拆文件，再考虑子目录（如 `repository/order/`）。

## 数据库

- schema 变更必须新增编号 .sql 迁移（`internal/db/schema/migrations/`），禁止启动时"检查表/自动补列"；
- 敏感配置（Token / 密码 / 密钥）一律写入 `secrets` 表（AES-GCM 加密），禁止明文进 `settings`。

## 事务边界（P0）

- **下单**：单事务完成"创建订单 + 锁卡密 + 扣库存"，成功 COMMIT、失败 ROLLBACK；优惠券/网关失败路径必须原子置 `payment_failed` 并**释放锁定卡密**（`MarkPaymentFailed`），禁止残留锁定库存；
- **支付成功**：单事务完成"订单 waiting_payment→paid + 卡密 locked→sold"，COMMIT 之后才发布发卡通知（异步）；**禁止在数据库事务内发送邮件/通知**；
- **取消/过期/回调**：一律用条件状态迁移（`WHERE status IN (...)`）防并发覆盖已支付订单；晚到回调不得产生任何变更；
- 任何新的失败路径都要在同一个事务里把状态与库存改一致。

## 并发库存（P0）

- 数据库连接固定 `_txlock=immediate`：所有事务 BEGIN 即获取写锁（SQLite 行锁模拟），写事务串行化；
- 锁卡/扣库存必须用**单条条件 UPDATE + RowsAffected 校验**（`WHERE id IN (SELECT ... LIMIT ?)`），禁止"先 SELECT 再逐条 UPDATE"；
- 库存=1 的两个并发购买必须恰好一个成功、一个得到库存不足业务错误，任何情况下不得超卖或重复锁定。

## 其他

- `jobs` 不直接依赖 `service`（用接口/回调解耦），避免 import 环；
- 新支付网关 = 新增 `payment.Gateway` 实现，不改业务层；
- 每次改动同步更新测试与 README（中英双份）；
- API 变更必须同步更新 `internal/api/api_docs/openapi.json`（yaml 由 json 用 `yaml.safe_dump` 重新生成）；
- 配置结构升级必须新增 `internal/db/settings_migrations.go` 编号步骤（记录到 `settings_version`），禁止在代码里直接改读法；
- 所有请求日志/支付日志必须带 `request_id`（中间件自动生成），支付日志另带 `order_no` 与 `trace_id`（网关交易号）；
- 领域事件必须走 `internal/events` 的类型化事件 + `events.Publisher`（service 禁止直接 `bus.Publish`）；新增事件在 events 包定义并统一分发；
- 外部事件（支付回调）必须以唯一键登记 `processed_events`（与状态变更同事务），重复事件返回幂等 noop；
- 关键领域事件（支付成功/发货）必须走 Outbox：与状态变更**同事务**写 `outbox_events`，由 outbox worker 发布；禁止只在提交后直接发布而丢失"提交成功但未发布"的窗口；
- Outbox 已发布事件保留 30 天由 cleanup 清理（未发布永不清理）；事件结构变更必须递增 `events.EventVersion` 并保持 `Decode` 兼容老版本；
- Outbox 连续失败 5 次必须进入 `dead_events` 停止重试；事件消费者必须走 `events.Fanout`（每消费者独立 goroutine + panic 隔离），禁止一个 consumer 拖垮全部；
- 并发/锁相关改动必须跑 `TestConcurrentPressure100`；迁移/回填改动必须跑 `TestLegacyDBUpgradeKeepsData`；
- 订单/支付/查询链路改动后跑 `go test -bench=. ./internal/integration/` 对比基准，防性能回退；备份改动必须跑恢复演练测试；
- 健康检查 `/health` 必须保留 database（size/migration_version/last_backup/integrity）与 jobs（queue_size/last_success）指标；
- 安全响应头（nosniff / X-Frame-Options / Referrer-Policy / Permissions-Policy / CSP / HSTS / Cookie Secure）改动必须同步 `internal/api/security_test.go`；
- SSR 缓存策略：动态页面与商品列表保持 no-store，ISR/edge cache 暂不实施；
- 数据库连接启动即确认 `journal_mode=WAL` / `busy_timeout=5000` / `foreign_keys=ON`；服务必须支持 SIGTERM 优雅停机（停止接收 → 排空 → worker 退出 → 关库）；
- API 变更必须同步 `admin-ui npm run gen:api` 重新生成 `src/api/types.ts`（CI 有 diff 校验），前端禁止手写接口类型；
- 支付/通知相关改动必须跑 `go test ./internal/integration/... ./internal/api/...`（MockGateway / NotifyRecorder 覆盖回调、重复回调、取消、超时）；
- 订单状态与支付状态必须分离：订单状态描述履约生命周期，支付状态写 `orders.payment_status`（created/pending/confirmed/failed/cancelled）；不得用订单状态表达支付语义；
- 备份逻辑必须带校验（备份后只读打开 + `PRAGMA integrity_check`，失败删除坏文件）；
- 后台任务执行必须记录 `job_runs`（由调度器统一写入 status/error），新增任务时确保返回 error 以正确记录失败；
- 部署：服务器 `git pull && go build ./... && go test ./internal/...` 通过后再替换二进制重启。
