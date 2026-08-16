# LiteShop 架构说明

## 模块边界

| 模块 | 职责 | 依赖 |
|---|---|---|
| order | 订单生命周期与业务编排（下单/支付确认/发货/取消/过期/补发/对账） | domain / application ports |
| product | 商品展示、价格、上下架、分类 | product domain |
| inventory | 库存数量、卡密锁定/释放/消耗/统计 | inventory domain |
| coupon | 优惠券规则与用量 | coupon domain |
| settings | 站点/支付/通知配置 | settings domain |
| admin | 管理员、会话、角色、TOTP、任务状态 | admin domain |
| audit | 审计日志 | audit domain |

模块互不通过内部实现耦合：跨模块协作一律走 application 层声明的端口（接口）。

## 依赖方向

```
transport/http ──> application ──> domain

repository/sqlite ──实现──> application/ports.go
payment/{bepusdt,hashpay} ──实现──> application/ports.go
notification ──实现──> application/ports.go

internal/app（组合根）负责组装：构造仓储/适配器 → 应用用例 → 传输层 Deps → 注册路由
```

禁止方向：domain → 仓储/HTTP/支付 SDK/日志/配置；application → 具体 SQL/SMTP/网关客户端；handler → 仓储/数据库连接/支付 SDK；job → 直接写业务表。

## 数据库选择

- SQLite（modernc.org/sqlite 纯 Go 驱动），WAL 模式，`_txlock=immediate` + 单连接，写事务串行化。
- 业务读写全部经各模块 `repository/sqlite`；`platform/database/sqlite` 只负责打开与迁移。
- 迁移：`migrations/` 编号文件 + `schema.Migrate` 按记录执行一次；禁止启动后静默改表。
- 备份：`VACUUM INTO` 一致性快照 + 只读 `integrity_check` 校验（platform/backup）。

## HTTP 层职责（transport/http）

- 解析请求、验证基础格式（邮箱/网关配置等）
- 组装应用命令（CreateCommand 等）并调用 Application
- 转换响应（typed request/response，不直接暴露领域/数据库字段）
- 不做业务判断：状态迁移、金额规则、库存规则都在 domain/application

## Service（application）层职责

- 一个主要业务动作一个文件（create.go / cancel.go / confirm_payment.go / fulfill.go / expire.go …）
- 依赖 domain 与 ports 接口，不感知 HTTP/SQL/第三方
- 通过端口编排跨模块能力（订单经 InventoryRepository 操作库存、经 CouponStore 用券）
- 支付回调收口为应用用例（HandlePaymentCallback），只认归一化状态

## Repository 层职责（repository/sqlite）

- 只做读写与事务内一致性（条件更新 + RowsAffected 校验、幂等台账、Outbox 同事务写出）
- 定义行模型（model.go）与 `toDomain/fromDomain`，数据库字段变化不污染业务层
- 不决定业务规则（是否可取消、金额是否正确、卡密如何发放）

## 第三方集成方式

- 支付：`payment/bepusdt`、`payment/hashpay` 实现 order 的 `PaymentGateway` 端口；原始状态（`2`/`paid`）在适配器内归一化为 `PaymentTxStatus`
- 通知：`notification` 实现 settings 的 `NotifierPort`；邮件重试策略在 `mailqueue.RetryService`
- 人机验证：`turnstile` 封装 Cloudflare siteverify
- 新增渠道 = 新增适配器实现同一端口并做状态映射，订单核心逻辑零改动

## 后台任务

`platform/scheduler/jobs` 只保留“触发器”（到点调用应用用例、记录执行结果），业务规则（过期/重试/清理）在对应 application 用例中。
