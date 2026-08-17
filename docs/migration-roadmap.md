# LiteShop 迁移路线图

原则：**不一次性搬完整个仓库**，按风险分四阶段逐步迁移。每阶段以
`make check`（格式 / 静态分析 / 测试 / 构建 / 模块隔离 / 命名 / 分层底线）
外加该阶段新增测试为门禁，通过后才进入下一阶段。

状态图例：✅ 已完成　🟡 部分完成　⬜ 待办

## 第一阶段：订单核心链路（生产风险最高）

迁移顺序固定为：订单状态和错误 → 创建订单 → 支付确认 → 卡密发放 →
取消订单 → 订单过期 → 支付对账。

| 项 | 状态 | 位置 |
|---|---|---|
| 订单状态与错误（强类型状态机 + 领域错误） | ✅ | `order/domain` + `order/domain/order_test.go` |
| 创建订单（库存校验 → 建单 → 支付交易，单事务锁卡） | ✅ | `order/application/create.go` + 仓储测试 |
| 支付确认（验签 → 幂等台账 → 条件状态迁移） | ✅ | `order/application/callback.go` + `processed_events` |
| 卡密发放（支付成功同事务售卡 / 补发） | ✅ | `order/application/fulfill.go` + inventory 事务端口 |
| 取消订单（释放卡密 + 回滚优惠券 + 网关取消） | ✅ | `order/application/cancel.go` |
| 订单过期（释放卡密 + 回滚优惠券） | ✅ | `order/application/expire.go` + `scheduler/jobs/order_expire.go` |
| 支付对账（卡在 `waiting_payment` 的订单主动查网关并对齐） | ⬜ | 无 reconcile 用例，待补 `order/application/reconcile.go` + 定时任务 |

第一阶段剩余工作：**支付对账**。现状只有网关侧的
`QueryOrderStatus` / `CancelTransaction` 竞态检查，缺少系统性的对账任务。
实现时沿用既有约束：状态变更与卡密/事件同事务、走 outbox、审计留痕、
`scheduler job` 只做触发器。

## 第二阶段：优惠券与通知

重点：优惠券重复使用；100% 优惠券自动完成；通知失败不影响订单；通知可重试。

| 项 | 状态 | 位置 |
|---|---|---|
| 优惠券重复使用（原子上限 + 退款幂等） | ✅ | `coupon/repository/sqlite` + 模块测试/并发集成测试 |
| 100% 优惠券自动完成（自动/人工交付） | ✅ | `order/repository/sqlite` CompleteFreeOrder(Manual) + 集成测试 |
| 通知失败不影响订单（异步任务，订单事务内不发通知） | ✅ | `notification` 端口化 + `jobs.Bus` |
| 通知可重试（mailqueue + 指数退避 + 邮件重试任务） | ✅ | `platform/mailqueue` + `scheduler/jobs/email_retry.go` |

## 第三阶段：商品与后台配置

| 项 | 状态 | 位置 |
|---|---|---|
| 商品（价格/上下架/库存经端口填充） | ✅ | `product` 模块 |
| 分类 | 🟡 | 已并入 `product`（分类为商品字段 + `AllCategories` 视图）；如需独立模块，按产品表所有权拆分 |
| 站点配置（敏感项 AES-GCM 入 secrets，编号迁移） | ✅ | `settings` 模块 + `settings_version` |
| 后台（管理员/会话/角色/TOTP/任务状态） | ✅ | `admin` 模块 |
| 安全（密码/TOTP/密钥派生/安全响应头） | ✅ | `platform/security` + `internal/app/security_test.go` |

## 第四阶段：统计与非核心功能

| 项 | 状态 | 位置 |
|---|---|---|
| 仪表盘 | ✅ | `admin/application/stats_service.go` Dashboard |
| 报表 | ✅ | `admin/application/stats_service.go` SalesReport |
| 导出 | ✅ | `order/transport/http` AdminOrdersExport（CSV 防注入） |
| 维护（清理任务/重置） | ✅ | `scheduler/jobs/cleanup.go` + admin 任务接口 |
| 备份（校验 + 恢复演练） | ✅ | `platform/backup` + 恢复演练测试 |

## 门禁

- 每个阶段完成必须通过 `make check` 及该阶段新增测试，才允许进入下一阶段；
- 后续任何迁移严格按本顺序执行，禁止跨阶段一次性大搬；
- 本文件由 `scripts/check-roadmap.sh` 校验存在性与阶段完整性，防止计划被无声删除。
