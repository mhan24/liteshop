# LiteShop 分层架构

## 目标

避免 web 层继续膨胀（当前 api.go + server.go 超 3600 行），将业务逻辑与数据访问从 HTTP handler 中剥离，
形成 **web → service → repository → db** 的分层。纯代码组织重构，不改变功能、不拆微服务。

## 分层

```
HTTP 请求
   │
   ▼
web (internal/web)
   ├─ handler: 参数解析 / 鉴权 / 响应序列化
   └─ 注入依赖: order.Service, notifier, bepusdt client
   │
   ▼
service (internal/order)
   ├─ 业务规则: 状态机、支付、发卡、取消、补发
   ├─ 依赖: repository, 支付 client, 通知回调
   └─ 供 web 调用
   │
   ▼
repository (internal/order)
   └─ 所有 SQL: 订单/卡密/日志 增删改查
   │
   ▼
db (internal/db)
   └─ SQLite 连接 + 迁移
```

## 当前已落地（订单 + 商品领域 + 死代码清理）

### internal/order/repository.go
封装 orders / cards / order_logs 的全部 SQL：
`CreatePendingOrder`（事务锁定卡密）、`MarkPaid`、`DeliverCards`、`ReleaseLockedCards`、
`GetOrderByNo/ID`、`ListOrders`（筛选）、`OrdersByContact`、`GetOrderCards`、`ListCardsByProduct`、
`AddCards`、`DeleteAvailableCard`、`ReserveCardsFromStock`、`SetOrderStatus(From)`、`GetOrderStatus`、
`OrderCounts`（驾驶舱统计）、`RecentOrders`、`AddLog`、`Logs`

### internal/order/service.go
订单业务规则：
- `CreateOrder`：创建订单 + 生成 BEpusdt 交易 + 状态推进（created→waiting_payment/payment_failed）
- `MarkPaidAndDeliver`：支付回调 → paid → 发卡 → delivered/delivery_failed（含日志）
- `Cancel` / `Expire`：释放卡密 + 状态迁移
- `Redeliver`：补发卡密（已有卡密直接确认 / 库存补扣）
- `SetStatus`：管理员手动改状态（保护已支付回退）
- 注入 `payFn`（动态支付 client）与 `cfgFn`（支付配置）、`SendPaid`（通知回调）

### internal/product/repository.go
商品与库存 SQL：`ListViews`（含库存统计）、`GetByID`、`GetBySlug`、`Create/Update`、
`AvailableCount`、`AllCategories`、`CardStockStats`、`LowStock`、卡密导入/删除

### internal/product/service.go
- `ListCategories`：分类分组 + 筛选（关键词/分类/价格）
- `Create/Update`、`GetView`、`GetActiveView`、`GetBySlug`、`AllCategories`

### web handler 改造
- 订单相关：`apiCreateOrder` / `handleBepusdtNotify` / `apiCancelOrder` / `apiAdminOrder*` → service/repo
- 商品相关：`apiProducts` / `apiProduct` / `apiAdminProducts` / `apiAdminProduct` / create/update → service/repo
- 驾驶舱：`apiDashboard` → repo 统计
- 订单/卡密列表、导出 → repo

### 死代码清理
删除 34 个未注册的旧 HTML handler（`handleCreateOrder` / `handleOrder` / `handleAdmin*` 等）
及其辅助函数（`render` / `publicData` / `listProductViews` / `markPaid` / `deliverOrder` 等 25 个），
server.go 从 1973 行减至 ~1140 行。

### 说明
- settings / admin / audit 采用轻量分层：`db.GetSetting/SetSetting`、`db.AddAuditLog/AuditLogs`、
  `db.AddOrderLog/OrderLogs` 已承担 repository 职责（internal/db 即 repository 层），未额外拆包避免过度设计。
- 旧 `templates.go`（adminIndex + 模板渲染）保留，服务 `/admin` SPA 入口。

## 依赖注入（web.NewHandler）

```go
s.orders = order.NewService(
    order.NewRepository(db),
    s.payClient,              // func() *bepusdt.Client, 每次读取最新 token
    s.paymentConfigForService, // func() order.PaymentConfig
)
s.orders.SendPaid = s.notifier.SendPaid
```

## 推广路径（下一步）

1. **商品领域**：✅ 已完成（internal/product）
2. **设置领域**：轻量方案（db.GetSetting/SetSetting 即 repository，配置读取集中在 web 层 siteSettings/paymentConfig）
3. **管理员/审计**：轻量方案（db.AddAuditLog/AuditLogs 即 repository），如需可抽 `internal/admin`
4. **清理 web 层遗留旧 HTML handler**：✅ 已删除 34 个 + 25 个辅助函数
5. **config 聚合**：将 `siteSettings` / `paymentConfig` / `notifyConfig` 的 db 读取抽成独立包（可选，边际价值较低）

## 约定

- Repository 不写业务规则，只做数据访问（SQL）。
- Service 不感知 HTTP，只依赖 repository 与注入的回调/客户端。
- Handler 不做业务判断，只做解析/校验/响应。
- 新功能优先写进对应领域包，禁止在 handler 中新增 `s.db.Query`。

## 验证

- 订单状态机/取消/卡密流转集成测试通过（internal/web/order_state_test.go，基于 order.Repository/Service）
- RBAC/审计测试通过（internal/web/rbac_test.go）
- 迁移系统测试通过（internal/db/migrations_test.go）
- 生产验证：下单/支付回调/订单查询/后台订单/商品/驾驶舱/卡密/日志 无回归
- 指标：web 层 4571 → ~3140 行；handler 直接 SQL 65 处 → 主要剩 settings 配置读写
