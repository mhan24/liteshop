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

## 其他

- `jobs` 不直接依赖 `service`（用接口/回调解耦），避免 import 环；
- 新支付网关 = 新增 `payment.Gateway` 实现，不改业务层；
- 每次改动同步更新测试与 README（中英双份）；
- API 变更必须同步更新 `internal/api/api_docs/openapi.json`（yaml 由 json 用 `yaml.safe_dump` 重新生成）；
- 支付/通知相关改动必须跑 `go test ./internal/integration/... ./internal/api/...`（MockGateway / NotifyRecorder 覆盖回调、重复回调、取消、超时）；
- 订单状态与支付状态必须分离：订单状态描述履约生命周期，支付状态写 `orders.payment_status`（created/pending/confirmed/failed/cancelled）；不得用订单状态表达支付语义；
- 备份逻辑必须带校验（备份后只读打开 + `PRAGMA integrity_check`，失败删除坏文件）；
- 后台任务执行必须记录 `job_runs`（由调度器统一写入 status/error），新增任务时确保返回 error 以正确记录失败；
- 部署：服务器 `git pull && go build ./... && go test ./internal/...` 通过后再替换二进制重启。
