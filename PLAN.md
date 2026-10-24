# liteshop v2 架构与重构记录（2026-10）

本次为**破坏性重写**：在 `rewrite/postgres` 分支上从零重建，不继承旧实现。旧代码仅用于提取业务需求。

## 1. 业务需求提取（来自旧项目）

从旧实现中确认的真实业务能力：

- 商品（自动发卡 / 人工发货）、库存展示、游客下单、站点统一币种（USD/CNY/EUR/GBP/JPY）
- BEpusdt 兼容收银台支付（pay.9527.tr LitePay、自建 setup0.de）：create-order / cancel-transaction / MD5 签名回调（status 1/2/3）
- 回调安全语义：验签、金额核对、幂等、创建结果未知 → 待对账、延迟到账 → 人工核对
- 过期清扫（惰性 + cron）、关单时通知网关撤销交易
- 交付邮件、SMTP 设置、测试邮件、失败重试
- 管理后台：商品/卡密/订单/渠道/站点设置、审计日志、登录限速、入口伪装
- SEO：商品页可索引、sitemap/robots

**有意不保留**（业务决策，见 §6）：

- 交易所直连轮询渠道（exchange:binance/okx）：已被 LitePay 收银台取代（同一业务能力，网关侧实现）
- 重新购买（repurchase）：v2 未纳入，如需可增量补；Turnstile 人机验证已恢复（见 §7）
- 旧 SQLite 数据：不迁移（重写授权明确）

## 2. 技术栈（实际版本）

| 模块 | 选型 | 版本 |
|---|---|---|
| 框架 | Next.js App Router（Turbopack，standalone 输出） | 16.4.0 |
| UI | React 19 + Tailwind CSS v4 + shadcn 风格组件（无运行时依赖） | react 19.3.0 |
| 语言 | TypeScript strict + noUncheckedIndexedAccess | 5.x |
| ORM / DB | Drizzle ORM + node-postgres | 0.45.4 / PostgreSQL 18 |
| 校验 | Zod | 4.6.5 |
| 密码 | @node-rs/argon2（Argon2id，查单密码）；node:crypto scrypt（管理员密码） | 2.2.2 |
| 邮件 | nodemailer | 10.x |
| 测试 | Vitest（单元 + 集成 + 并发，测试库独立 PostgreSQL） | 5.x |
| 部署 | Docker Compose：app + db + caddy + backup + cron | |

## 3. 数据模型（src/db/schema.ts）

`settings`（KV）、`admins`、`categories`、`products`、`orders` + `order_items`（购物车明细快照）、
`cards`（available/reserved/sold + (product_id, content) 唯一）、`payment_channels`（多实例渠道，令牌 AES-256-GCM 加密）、
`payments`（(channel_id, provider_ref) 部分唯一索引 = 回调幂等锚点；is_current 标记当前尝试；anomaly 标记 late）、
`deliveries`（order_id 唯一 = 交付幂等锚点 + 邮件重试字段）、`notify_logs`（回调审计 + payload_hash 去重）、`audit_logs`。

金额一律 bigint 最小单位（分）；全部外键带明确 onDelete；查询路径索引齐备。

## 4. 关键流程

### 下单（server/orders.ts createOrder）
1. Zod 校验（邮箱/slug/数量），查单密码 Argon2id 哈希
2. 单事务：商品快照 → 建订单+明细 → `reserveStock`（auto：`FOR UPDATE SKIP LOCKED` 占卡并绑定订单；manual：条件原子扣减 stock_limit）
3. 事务外渠道建单：created / rejected（补偿关单释放）/ unknown（→ reconciling，**绝不释放库存**）
4. 订单号唯一冲突整体重试（3 次）

### 回调（handlePaymentWebhook）
验签（常量时间比较）→ notify_logs 审计 → 事务：payload_hash 幂等 → 订单行锁 →
(status=1 记录 / status=3 仅当前尝试关单释放 / status=2：金额核对 → payments 幂等 → pending|reconciling→paid →
事务内原子发卡 reserved→sold → deliveries（order_id 唯一）→ 全 auto 即 completed；含 manual 停留 paid)。
订单已终结/非当前尝试 → payment 记 late，人工核对。DB 异常回 "fail" 让网关重试，其余回 "success"。

### 查询（order-query.ts）
邮箱 + 订单号 + 查单密码三因子；Argon2id 验证；action 层 IP+邮箱限流。仅凭邮箱不可访问。

## 5. 与旧实现的重要差异

- **middleware → proxy**：Next 16 新约定（src/proxy.ts），后台入口伪装逻辑等价迁移
- **后台表单**：统一 `(prev, formData) => {ok,message}` + `useActionState` 内联反馈，无 GET 重定向
- **渠道模型**：payment_channels 表驱动（多实例 epusdt 渠道），替代硬编码 bepusdt/litepay 两渠道；令牌加密落库
- **购物车**：多商品订单（order_items），金额服务端重算
- **连接层**：node-postgres 异步 API（全部 await），Pool max=10

## 6. 切换生产（需要人工决策，未执行）

1. 服务器 `docker compose up -d --build` 会创建全新 PostgreSQL——**历史订单/卡密/渠道凭据不迁移**，需在后台重新录入支付渠道 Token（LitePay / setup0.de）
2. `.env` 需要新格式（见 .env.example）：DATABASE_URL、AUTH_SECRET、ADMIN_PASSWORD_HASH、DOMAIN、POSTGRES_PASSWORD、CRON_SECRET
3. Caddyfile 按 DOMAIN 自动 HTTPS；数据库仅 internal 网络
4. 旧版回滚：切回 main 分支重新构建即可（旧 SQLite 数据仍在服务器卷中）

## 7. 已知边界（如实列出）

- Turnstile 已集成（下单/查询两入口，后台设置页配置；含验证服务不可用降级开关）；未开启时限流为唯一防护
- 不支持秒杀/高并发场景（单实例 + 行级锁，符合业务规模）
- 邮件失败重试上限 5 次（cron 每 60s），超出需人工介入
- 未做自动化浏览器 E2E 脚本（购买全流程已用真实浏览器人工验证 + 集成测试覆盖服务层全路径）
