# liteshop 架构与重构记录

2026-10 的 v2 为**破坏性重写**（PostgreSQL + Drizzle，不继承旧实现）；
2026-11 又做了一轮**破坏性重构**：支付收口到单一 LitePay 网关、只保留卡密自动发货、
全站收敛为 USD 单币种，前台与文案按编辑风格重做。

## 1. 业务范围

只有一种生意：**卖数字卡密，付款后自动发货**。

- 商品（分类、搜索、库存实时展示）、购物车、游客下单（无需注册）
- 单一支付网关：LitePay 收银台（BEpusdt 兼容 JSON 接口），USDT / USDC 付款
- 交付：支付确认后数据库事务内原子发卡，页面即时展示 + 邮件同步
- 订单查询：订单号 + 下单邮箱 + 每单独立查单密码，三因子
- 管理后台：商品/分类/卡密/订单/站点设置/支付网关配置、审计日志、登录限速、入口伪装
- SEO：商品页 ISR + JSON-LD、sitemap、robots、canonical / OG；订单、支付、后台全部 noindex

**有意不做**：

- 人工发货商品（旧 `manual` 类型、库存上限字段一并删除）
- 多渠道支付表（旧 `payment_channels` 多实例 CRUD）
- 多币种（旧 USD/CNY/EUR/GBP/JPY）——LitePay 只受理 USD，留着只会做出必然失败的订单
- 交易所直连轮询渠道、买家账户体系、重新购买

## 2. 技术栈

| 模块 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js App Router（standalone 输出） | 16.4.0 |
| UI | React 19 + Tailwind CSS v4（无 UI 运行时依赖） | react 19.3.0 |
| 语言 | TypeScript strict + noUncheckedIndexedAccess | 5.x |
| ORM / DB | Drizzle ORM + node-postgres | 0.45.4 / PostgreSQL 18 |
| 校验 | Zod | 4.x |
| 密码 | @node-rs/argon2（查单密码）；node:crypto scrypt（管理员密码） | |
| 邮件 | nodemailer | 10.x |
| 测试 | Vitest（单元 + 集成 + 并发） | 5.x |
| 部署 | Docker Compose：app + db + caddy + backup + cron | |

## 3. 数据模型（src/db/schema.ts）

`settings`（KV）、`admins`、`categories`、`products`、`orders` + `order_items`、
`cards`（available/reserved/sold + (product_id, content) 唯一）、
`payments`（`channel` ∈ litepay|mock；`(channel, provider_ref)` 部分唯一索引 = 回调幂等锚点；
`is_current` 标记当前尝试；`anomaly` 标记 late）、
`deliveries`（order_id 唯一 = 交付幂等锚点 + 邮件重试字段）、`notify_logs`（回调审计 + payload_hash 去重）、`audit_logs`。

- 金额一律 bigint「美分」，禁止浮点参与金额运算；不存币种列（全站 USD）
- 商品没有发货方式字段：库存 = 该商品 `available` 卡密数量
- 全部外键带明确 onDelete；查询路径索引齐备

## 4. 关键流程

### 下单（server/orders.ts createOrder）

1. Zod 校验（邮箱 / slug / 数量），生成查单密码并哈希
2. 单事务：商品快照 → 建订单 + 明细 → `reserveStock`（`FOR UPDATE SKIP LOCKED` 占卡并绑定订单）
3. 事务外调 LitePay 建单：`created` / `rejected`（补偿关单释放卡密）/ `unknown`（→ reconciling，**绝不释放库存**）
4. 订单号唯一冲突整体重试（3 次）

### 回调（POST /api/webhooks/litepay → handlePaymentWebhook）

验签（MD5 + 常量时间比较）→ notify_logs 审计 → 事务：payload_hash 幂等 → 订单行锁 →
LitePay 只发 `status=2`（其它 status 记录后忽略）→ 金额核对（美分精确相等）→ payments 幂等 →
pending|reconciling → paid → 事务内原子发卡 reserved→sold → deliveries（order_id 唯一）→ completed。
订单已终结/非当前尝试 → payment 记 late，人工核对。DB 异常回 "fail" 让网关重试，其余回 "success"。

### 金额与签名（lib/money.ts、lib/litepay-sign.ts）

- 签名：剔除 signature 与空值 → 键升序 → `k=v` 用 `&` 拼接 → 末尾拼接口令牌 → MD5 小写。
  数值必须保持 JSON 十进制形态；网关按 `json.Number` 原文验签，指数形式永远对不上
- 回调金额按美分解析：接受 6 位小数尾零，低于 0.01 的尾数直接判非法（不四舍五入）
- 建单金额限制在 0.01–999999.99 USD（网关受理区间 [0.0001, 1000000) 的可用子集）

### 网关配置（后台「设置 · 支付网关」）

`settings` KV：`litepay_enabled` / `litepay_api_base` / `litepay_token_enc`（AES-GCM，密钥派生自
AUTH_SECRET）/ `litepay_timeout_seconds`（120–86400）/ `litepay_currencies` / `litepay_reselect`。
回调地址固定，令牌不回显；SMTP 密码与 Turnstile Secret 同样加密存储（存量明文由启动迁移一次性加密）；`PAYMENT_DRIVER=mock` 时改用进程内模拟网关（开发与测试）。

### 查询（server/order-query.ts）

邮箱 + 订单号 + 查单密码三因子；Argon2id 验证（不匹配时对 dummy 哈希同等开销校验）；action 层 IP+邮箱限流。
买家取消订单、重新发起支付同样要求三因子。仅凭邮箱或订单号不可访问、不可改动订单。

## 5. 与其他实现的差异

- **middleware → proxy**：Next 16 新约定（src/proxy.ts），后台入口伪装逻辑等价迁移
- **后台表单**：统一 `(prev, formData) => {ok,message}` + `useActionState` 内联反馈，无 GET 重定向
- **支付**：单一 LitePay 适配器，替代 v2 的多实例渠道表；webhook 路径固定为 `/api/webhooks/litepay`
- **UI**：编辑风格排版（暖调单色、1px 边框、极轻动效），文案按「说事实、不堆形容词」重写

## 6. 迁移（0001_litepay_gateway.sql）

破坏性 SQL，随容器启动自动执行：

- 删除 `payment_channels` 表与 `payments.channel_id`，新增 `payments.channel`（默认 `litepay`）
- 删除 `payments.currency`、`orders.currency`
- `notify_logs.channel_key` 重命名为 `channel`
- 删除 `products.delivery_type`、`products.stock_limit`

历史订单与卡密保留；旧的人工发货商品退化为「无卡密即缺货」，需要补卡后才能继续卖。

## 7. 已知边界

- 不支持秒杀/高并发场景（单实例 + 行级锁，符合业务规模）
- 邮件失败重试上限 5 次（cron 每 60s），超出需人工介入
- 卡密不足时订单停在 `paid`（一张不卖，全有或全无），后台补卡后「重试发卡」会从可售库存补锁缺口
- 未做自动化浏览器 E2E；服务层全路径由集成测试覆盖
