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

## 当前已落地（订单领域试点）

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

### web handler 改造
- `apiCreateOrder` → `s.orders.CreateOrder`
- `handleBepusdtNotify` → `s.orders.MarkPaidAndDeliver`
- `apiCancelOrder` / `apiAdminOrder*`（expire/cancel/status/redeliver/resend）→ service/repo
- `apiOrder` / `apiOrdersByContact` / `apiAdminOrders` / export / cards → repo

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

1. **商品领域**：`internal/product`（Repository + Service）
   - `listProductViews` / `getProductView` / `allCategories` / 商品 CRUD SQL → repository
   - 商品创建/编辑/下架规则 → service
2. **设置领域**：`internal/settings`（Repository + Service）
   - settings 表读写、siteSettings/paymentConfig/notifyConfig → repository
3. **管理员/审计**：`internal/admin`（Repository + Service）
   - admins CRUD、角色校验、audit_logs → repository/service
4. **清理 web 层遗留旧 HTML handler**
   - server.go 中未注册的 handle* 旧模板 handler（handleCreateOrder/handleOrder/handleAdmin* 等）
   - 及 render/templates.go/tr/chooseLang 依赖，迁移完成后删除

## 约定

- Repository 不写业务规则，只做数据访问（SQL）。
- Service 不感知 HTTP，只依赖 repository 与注入的回调/客户端。
- Handler 不做业务判断，只做解析/校验/响应。
- 新功能优先写进对应领域包，禁止在 handler 中新增 `s.db.Query`。

## 验证

- 订单状态机/取消/卡密流转集成测试通过（internal/web/order_state_test.go）
- RBAC/审计测试通过（internal/web/rbac_test.go）
- 迁移系统测试通过（internal/db/migrations_test.go）
- 生产验证：下单/支付回调/订单查询/后台订单/卡密/日志 无回归
