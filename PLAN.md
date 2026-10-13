# liteshop — 轻量数字商品（卡密）售卖站

> 参考独角数卡（Dujiao-Next）核心业务形态的精简实现。
>
> - 前台：商品展示 + 游客购买（无注册）
> - 后台：商品 / 卡密 / 订单 / 设置管理
> - 发货：自动卡密发货 + 手动录入人工发货
> - 收单：对接 [bepusdt](https://github.com/v03413/bepusdt)（USDT 支付网关）
> - UI：shadcn/ui，审美遵循 taste-skill · **minimalist-ui**（极简编辑风）
> - 部署：Docker

---

## 1. 技术选型

| 层 | 选型 | 说明 |
|---|---|---|
| 框架 | Next.js（App Router）+ TypeScript | 前台与后台同一应用，Server Actions 处理表单 |
| UI | Tailwind CSS + shadcn/ui | 组件按 minimalist-ui 规范定制（见 §7） |
| 数据库 | SQLite + Drizzle ORM（better-sqlite3） | 单文件库 `/app/data/liteshop.db`，Docker 卷挂载 |
| 会话 | HMAC 签名 HttpOnly Cookie | 管理员登录态；账密来自 `.env` |
| 测试 | vitest | 签名 / 幂等 / 并发 / 金额解析单测 |
| 部署 | Docker 多阶段构建（node:22.23-bookworm-slim，standalone 输出） | 附 docker-compose.yml |
| 界面语言 | 中文 | |

## 2. 目录架构

业务逻辑全部位于 `src/server`，页面层只做 UI 与输入输出：

```
src/
├── app/                          # 路由与页面（薄壳）
│   ├── (shop)/                   # 前台：/、/products/[slug]、/pay/return、/orders
│   ├── admin/                    # 后台：登录、仪表盘、商品/卡密/订单/设置
│   └── api/pay/notify/[provider]/route.ts   # 支付回调（验签后转发 service 层）
├── components/ui/                # shadcn/ui 组件（按 taste-skill 定制）
├── db/                           # Drizzle schema、迁移、种子
├── server/                       # 核心业务服务
│   ├── order/                    # create-order.ts、fulfill-order.ts、状态机
│   ├── delivery/                 # strategy.ts(接口)、auto.ts、manual.ts
│   └── payment/                  # index.ts(PaymentProvider 接口)、bepusdt.ts、mock.ts
├── lib/                          # 纯函数工具（money、session、签名、order_no）
└── actions/                      # Server Actions（调 server 层）
```

后续接入 Stripe / PayPal / 支付宝 / TG bot 下单，只需新增 `server/payment` 实现或入口适配器，不污染页面层。

## 3. 数据模型（Drizzle）

> 迁移必须全部 additive，禁止修改历史迁移文件。

- **products**：`name / slug / description / image_url / price(分,INTEGER) / currency(默认CNY) / extra(JSON 扩展位) / delivery_type(auto|manual) / stock_limit(manual 用，-1=不限，0=售罄，正数=剩余数量) / status(上下架) / sort`
- **cards**（卡密池）：`product_id / content / status / order_id / sold_at`
  - `CardStatus = "available" | "reserved" | "sold"`
  - 生命周期：`available --create-order--> reserved（占卡，写入 order_id）--成功--> sold（落 sold_at）`；发货失败 / 关单时 reserved 释放回 available
  - 允许重复内容按独立卡密行导入；库存安全由条件占卡与事务保证，不以内容唯一性保证
- **orders**：
  - **order_no 非自增**：`LS + YYYYMMDD + 8位随机(base32) + 2位校验和`（如 `LS2026101112345678A9`），唯一索引 + 插入冲突重试，避免暴露销量
  - 商品快照（name / unit_price / currency）/ quantity / total / email / status / delivery_content / trade_id / expected_actual_amount / expiration_time / block_txn_id / paid_at
  - `OrderStatus = "pending" | "paid" | "delivering" | "completed" | "expired" | "closed" | "reconciling"`
    - `paid` = 已支付待处理（manual 型停留态，等待人工发货）
    - `delivering` = 自动发货进行中（占卡中 / 卡池空待补 / 临时失败；后台可补卡后重试发货，或直接人工录入 → completed）
- **settings**：仅站点级（site_name / site_url 等）
- **payment_configs**：`provider / enabled / config_json`（bepusdt 的 api_base / token / trade_type / timeout 存 config_json；未来 stripe / paypal / alipay 加行不改表）
- **admin_logs**：审计（动作 / 目标 / 详情 / IP / 时间）
- **notify_logs**：回调原始报文 + **payload_hash = sha256(raw_body)**（索引），用于重复通知识别与重放排查

- **payment_attempts**：每次支付尝试独立保存渠道、trade_id、币种、金额与实付金额快照；只有当前尝试推动正常履约。
- **payment_anomalies**：历史或迟到到账进入人工核对队列；已完成订单不得再次自动补发。
- **reconciling**：创建支付结果未知，保留占库等待对账；禁止普通超时释放或直接重新购买。

### 订单状态机

```
            ┌────── 回调 status=2（验签 + 金额校验 + 幂等）
pending ────┤
            │      ├─ auto 型：paid → delivering（事务内占卡）→ completed
            │      │                          ↘ 卡池空/失败 → 停留 delivering（后台补卡重试或人工录入）
            │      └─ manual 型：→ paid → 管理员录入交付内容 → completed
            ├────── 回调 status=3（超时）→ expired
            └────── 管理员手动 → closed（reserved 卡密释放回 available）
```

## 4. 页面与路由

### 前台（路由组 `(shop)`，游客模式）

| 路由 | 说明 |
|---|---|
| `/` | 商品列表：bento 卡片网格（图、名、价、简介、购买按钮），仅上架商品 |
| `/products/[slug]` | 商品详情：描述 + 购买表单（邮箱必填、数量、可选备注）+ 卡密余量 |
| `/pay/return?order_no=…` | 支付回跳页：轮询订单状态并展示结果 |
| `/orders` | 查单页：**订单号 + 邮箱**双因子查询，展示状态与卡密 / 交付内容 |

### 后台（`/admin`，Session 鉴权）

| 路由 | 说明 |
|---|---|
| `/admin/login` | 登录（.env 账密、失败限速、CSRF token） |
| `/admin` | 仪表盘：今日/累计订单与销售额、待人工发货数（含 delivering）、卡密余量预警 |
| `/admin/products` | 商品管理：Table 列表 + Dialog 表单增删改、上下架、delivery_type 切换 |
| `/admin/cards` | 卡密管理：批量导入（textarea 一行一个）、余量/已售查看（已售关联订单）、删除未用卡密 |
| `/admin/orders` | 订单管理：筛选+搜索；paid/delivering 订单人工发货、重试发货、补发卡密、关闭订单 |
| `/admin/settings` | 站点设置 + 支付渠道配置（payment_configs） |

### API

| 端点 | 说明 |
|---|---|
| `POST /api/pay/notify/[provider]` | 支付回调：验签 + 金额校验 + 幂等发货，应答 `success`（HTTP 200） |
| `GET /api/health` | 健康检查（含 DB 只读探测，供 Docker healthcheck） |
| Server Actions | 下单、查单、登录/登出、后台 CRUD（全部经 server 层） |

## 5. bepusdt 对接（server/payment/bepusdt.ts，已源码级核实）

**创建交易**：`POST {api_base}/api/v1/order/create-order`

| 参数 | 必填 | 说明 |
|---|---|---|
| order_id | ✅ | 商户订单号（本站 order_no，唯一） |
| notify_url | ✅ | `https://站点域名/api/pay/notify/bepusdt` |
| redirect_url | ✅ | `https://站点域名/pay/return?order_no=…` |
| signature | ✅ | 签名（见下） |
| amount | ❌ | 法币金额（CNY） |
| trade_type | ❌ | 收银台模式不传；买家选择币种与网络 |
| fiat | ❌ | 默认 `CNY` |
| name | ❌ | 商品名 |
| timeout | ❌ | 超时秒数，范围 180–3600；默认值由网关配置决定 |

响应 `data`：`fiat / trade_id / order_id / amount / actual_amount / status / token / expiration_time / payment_url`。

**签名 / 验签算法**（EpusdtSign 源码核实）：

1. map 化全部字段，剔除 `signature`，跳过空值（nil / 空字符串）
2. 键 ASCII 字典序排序
3. 以 `k=v&` 拼接，值经 Go `%v` 等价格式化（float `42.0`→`"42"`、bool→`"true"/"false"`；JS `String()` 与之一致）
4. `TrimRight("&")` 后直接拼接 API Token（无分隔符）
5. MD5 → 小写十六进制

**回调通知**（POST JSON → notify_url，`EpNotify` 源码字段）：

- `trade_id / order_id / token / block_transaction_id / signature` = string；**`amount` = float64；`actual_amount` = string；`status` = int（1 等待 / 2 成功 / 3 超时）**
- 处理：验签（timingSafeEqual）→ order_no 存在且 trade_id 与创建快照一致 → amount / actual_amount 转 BigInt 分比较 → status=2 才入账发货；status=1 仅记录；status=3 → expired
- 应答：HTTP 200 + `success`（源码判定：响应体含 success/ok 不区分大小写）；失败靠其退避重试（2/4/8…分钟最多 10 次）

## 6. 风险对策

1. **卡密库存并发安全**：领卡用条件原子 `UPDATE … WHERE status='available' … RETURNING`（受影响行数判库存，不超卖）；发货在 better-sqlite3 **IMMEDIATE 事务**内（状态机守卫 → 占卡 → 确认/释放 → 提交）；manual 库存条件扣减；SQLite 单写者 + Next standalone 单进程 + compose 单副本；并发单测：同一订单 10 次并发回调仅发 1 卡
2. **支付金额防篡改**：履约只信服务器间回调（前端回跳页仅展示）；常量时间验签 → trade_id 对快照 → 金额 BigInt 分比较 → status=2 入账；原始报文 + payload_hash 落 notify_logs
3. **管理后台安全**：`.env` 存 `ADMIN_PASSWORD_HASH`（scrypt，`npm run hash-password` 生成）；HMAC 会话（HttpOnly / SameSite=Lax / Secure 反代 TLS / 8h / session_version 全局登出）；CSRF token + Origin 校验；登录限速（IP+账号 5 次失败锁 15 分钟）；middleware 守护 `/admin/*`；安全响应头；admin_logs 审计；README 强制 HTTPS
4. **SQLite Docker 部署**：builder 装 python3/make/g++ 编译 better-sqlite3（Debian glibc 匹配）；固定 node:22.23-bookworm-slim 具体版本 + `npm ci && npm rebuild better-sqlite3`（防未来升 Node 出 invalid ELF header，README 写升级流程）；启动 PRAGMA（WAL / synchronous=NORMAL / busy_timeout=5000 / foreign_keys=ON）；named volume + healthcheck；`npm run backup`（VACUUM INTO 在线备份）；非 root 运行
5. **bepusdt 字段**：以网关源码为准（见 §5），单测对齐官方 PHP SDK
6. **商品模型扩展性**：currency + extra(JSON) 预留；PaymentProvider / DeliveryStrategy 双接口；additive 迁移；payment_configs 拆表

## 7. 设计规范（taste-skill · minimalist-ui）

规范文件装入 `skills/minimalist-ui/SKILL.md`（`npx skills add https://github.com/Leonxlnx/taste-skill --skill "minimalist-ui"`，失败则直接下载），全程严格执行：

- **排版**：Geist Sans（正文/UI）+ Instrument Serif（大标题，字距 -0.02em、行高 1.1）+ Geist Mono（订单号/金额元数据），经 `next/font` 加载；正文 `#111111`（禁纯黑），次要 `#787774`，行高 1.6
- **配色**：背景 `#F7F6F3` / `#FFFFFF`，卡片 `#FFFFFF`，边框一律 `1px solid #EAEAEA`；禁渐变、重阴影（≤ `rgba(0,0,0,0.04)`）；点缀仅淡粉彩（状态徽章：pale red `#FDEBEC`/`#9F2F2D`、pale blue `#E1F3FE`/`#1F6C9F`、pale green `#EDF3EC`/`#346538`、pale yellow `#FBF3DB`/`#956400`）
- **组件**：图标统一 **@phosphor-icons/react**（替换 Lucide）；主 CTA `#111111` 底白字、圆角 4–6px、`active:scale-0.98`；禁 emoji、禁占位文案、禁 AI 营销套话
- **布局**：bento 风商品网格（1px 边框、圆角 12px、内边距 24–40px）；区块间距 py-24 起步；内容宽度 max-w-4xl/5xl
- **动效**：仅 transform/opacity；入场 translateY(12px)+opacity、600ms、`cubic-bezier(0.16,1,0.3,1)`、列表 80ms 级联错峰，IntersectionObserver 实现（禁 scroll 监听）；卡片 hover 淡阴影 200ms

前台与后台遵循同一规范，保持扁平编辑风。

## 8. Implementation Notes

- 所有金额内部使用整数分（BigInt），边界处经 `toCents()` 转换
- 所有状态使用 TypeScript string union（OrderStatus / CardStatus）
- 所有数据库迁移必须 additive，禁止直接修改历史 migration

## 9. Engineering Constraints

- 页面层只负责 UI 与输入输出
- 所有业务逻辑必须位于 `src/server`
- 所有数据库写操作必须经过 service 层
- 禁止 API Route 直接操作数据库
- 所有支付渠道必须实现 PaymentProvider 接口
- 所有发货方式必须实现 DeliveryStrategy 接口
- 所有订单状态变化必须经过状态机校验
- 禁止硬删除已产生交易关联的数据

## 10. 本地验证

- `PAYMENT_DRIVER=mock`：server/payment/mock.ts 实现同一 PaymentProvider 接口，本地模拟收银台一键支付成功 → 带正确签名回调 → 跑通完整发卡链路（无需真实 bepusdt）
- 单测：签名对齐、验签拒绝、回调幂等、并发领卡、toCents 边界
- 浏览器自动化全流程验收：导卡密 → 建商品 → 下单 → mock 支付 → 查单取卡密 → 人工发货闭环；按 taste-skill 检查清单核对视觉

## 11. 里程碑

| 里程碑 | 状态 | 验收依据 |
|---|---|---|
| 骨架、数据层、核心服务、mock、后台、bepusdt、前台 | 已实现；持续回归 | 当前源码及 `npm test`，修复记录见 docs/audits/2026-10-13/REPORT.md |
| Docker 与生产发布 | 已有部署记录 | docs/DEPLOYMENTS.md；生产版本与 GitHub 修复版本分别记录 |
| 支付成功分类与库存事务复审 | 本轮修复，待用户授权部署 | success-classification.test.ts、stock-commitment.test.ts；本地与 CI 验证后推送 |
| 浏览器端到端与真实支付回归 | 每次发布按影响范围验收 | 需独立记录；单元测试不代替生产验收 |

README 内容：Docker 部署、bepusdt 配置说明（Token 获取路径：bepusdt 后台 → 系统管理 → 基本设置 → API 设置 → 对接令牌；notify_url 填写方式）、首次使用指引、Node 升级注意事项。

---

## 变更记录

### 2026-10-11 · 部署后迭代（v1.1）

1. **bepusdt 收银台模式**：创建订单改用 `POST /api/v1/order/create-order`（不再传 `trade_type`），买家在 bepusdt 收银台自选币种/网络；后台设置移除「默认交易类型」，超时下限调整为 180 秒。
2. **SMTP 邮件通知**：新增 `mail_logs` 表（`UNIQUE(order_no, kind)` 幂等）与 `server/mail.ts`；后台可配置 SMTP（含发送测试邮件）。触发点：自动发卡完成→交付邮件；人工商品支付确认→处理中邮件；人工发货完成/补发卡密→交付邮件；订单页支持「补发交付邮件」。
3. **管理员与后台入口**：管理员用户名/密码改为 DB 设置优先（.env 为引导兜底），设置页可修改（需验证当前密码，成功后全局登出）；`settings.admin_path` 支持后台入口路径伪装（如 /my-panel），旧 /admin/* 返回 404，中间件改写并注入 `x-admin-base`，全站后台链接自动跟随。
4. **运维**：哈希格式分隔符由 `$` 改为 `:`（规避 Docker Compose env_file 插值损坏，解析兼容两种）；Docker 基础镜像锁定 `node:22.23-bookworm-slim`（Turbopack 不兼容 Alpine/musl ARM；部分 ARM 主机 Node 20 原生 SQLite 调用会 SIGSEGV）。

### 2026-10-11 · v1.2：站点币种统一（USD）

- 新增站点设置 `currency`（默认 USD，可选 USD/CNY/EUR/GBP/JPY，与 bepusdt fiat 对齐）
- 全站金额展示统一走 `formatMoney(cents, currency)`（`$9.90` / `¥42.50`，未知币种回退代码前缀）
- 新建商品默认跟随站点币种（对话框可改）；编辑留空保持原值
- bepusdt create-order 的 `fiat` 跟随订单币种（不再写死 CNY）
- 邮件模板、仪表盘、订单列表、前台卡片/详情/查单/回跳页全部替换硬编码 `¥`/`CNY`

### 2026-10-12 · v1.3：卡密重复销售 / 待支付页 / 查单验证码 / 北京时间

1. **卡密可重复销售**：移除 `UNIQUE(product_id, content)` 与导入去重，同一内容可导入多张多次售出（测试场景）；超卖防护由发货事务条件 UPDATE 保证（新增迁移 0002）。
2. **下单即锁定卡密**：auto 商品下单时事务内原子占卡（reserved + order_id）；支付转 sold，超时/关闭自动释放回 available，库存不足直接拒单。
3. **待支付页**：新增 `/pay/pending?order_no=`；订单持久化 `payment_url`，从收银台回退/误关后可回到该页继续支付；未过期复用原收银台地址（不轮换 trade_id），过期后一键重新发起；下单后先落此页再进收银台；回跳页与查单页对 pending 订单均提供「继续支付」。
4. **查单人机验证**：查单改为 Server Action 流程，启用 Turnstile 后需先完成挑战；待支付结果页提供继续支付。
5. **北京时间**：全站时间显示统一 `Asia/Shanghai`（lib/datetime），禁止 toISOString 直接展示。

### 2026-10-12 · v1.4：主题切换 / 前台文案 / 后台快捷链接

1. **深浅主题**：next-themes（class 策略），默认跟随系统；前台页头与后台侧栏/顶栏提供切换按钮，`.dark` 调色板全站覆盖。
2. **前台文案后台可改**：新增 `server/copy.ts` 文案注册表（首页主/副标题、眉标、空状态、购买按钮/须知、详情与查单与待支付页提示、页脚），后台「前台文案」卡片编辑，留空恢复默认；存储键 `copy_*`。
3. **后台跳前台**：侧栏与顶栏新增「前往前台」新窗口链接。

### 2026-10-13 · 审计修复

- 成功回调先按具体支付尝试分类，终态订单也登记经过逐尝试快照校验的历史到账；当前交易金额异常不进入历史到账补发队列。
- 商品编辑的读取、未结束订单守卫、更新以及建单的商品快照读取均置于各自 IMMEDIATE 事务内。
- 审计固定包含修复、回归验证和 GitHub 推送；生产部署需用户当次明确指令。

### 2026-10-13 · 第二轮独立审计修复

- 已完成订单的成功通知按具体交易是否已入账判幂等；另一笔新到账登记 duplicate_payment，不重复交付。
- 全局活跃订单容量在建单 IMMEDIATE 事务内复核，保留前置频率限制；待对账阈值为阻止新单的熔断规则。
- 健康接口异常时不返回内部错误。回归与边界见 docs/audits/2026-10-13/ROUND-2.md。

### 2026-10-13 · v1.5：Turnstile 不可用降级 + 重试死锁修复

- 根因确认：买家/店主网络到 challenges.cloudflare.com 不稳时，验证脚本拿不到有效响应 → 控件停在「加载中」→ 提交按钮永久禁用，表现为「选任何支付方式点购买都没反应」（与支付方式无关）。
- 修复：① Turnstile 重试用 cache-bust 重建脚本节点（旧节点已"加载完成"时重试会死锁）；脚本 load 后 API 仍不存在立即判失败（不再等超时）；② 新增后台降级开关「验证服务加载失败时允许提交」：开启后无 token 提交放行（下单/查单频率限制兜底，有 token 仍严格校验）；③ 前端降级态下提交按钮不禁用、按钮文字提示引导；④ CSP 补 Cloudflare Web Analytics 白名单。
- 交易所下单链路经生产模式（standalone + 真实 Chrome）全流程验证无代码缺陷。

### 2026-10-13 · v1.6：购买链路对验证服务故障完全免疫

- **「选交易所付款没反应」定性**：交易所下单链路经 standalone+真实 Chrome 全流程验证无代码缺陷；根因是买家网络到 challenges.cloudflare.com 拿到无效响应 → Turnstile render 后静默等待（无 iframe、无回调）→ 提交按钮被禁用 → 点购买无反应（所有支付方式相同）。
- **下单成功改为服务端 redirect**（/pay/pending?order_no&email）：React 接管与渐进增强（JS 全禁）两条路径都跳转待支付页，下单链路不再依赖客户端脚本时序。
- **Turnstile 15 秒总预算改 1s 轮询实现**：覆盖「render 成功但 challenge 无响应」的静默失败；超时移除僵尸 widget 并判不可用。
- **降级开关已上线**（后台可关）：验证不可用时无 token 提交放行，由下单/查单频率限制兜底；前端按钮解禁并带 cfFallback 标记。
- 生产实测：验证失败 15s → 错误提示+按钮解禁 → 选交易所下单 → 到达待支付页 ✓。
