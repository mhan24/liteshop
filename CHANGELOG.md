# 更新日志

## v0.3.0（2026-08-11）— 前后台迁移 shadcn-vue

### 后台（admin-ui）

- 移除 daisyUI，改用 **shadcn-vue（reka-nova 风格）**：Button / Card / Input / Select / Textarea / Table / Dialog / AlertDialog / DropdownMenu / Badge / Checkbox / Switch / RadioGroup / Accordion / Tabs / Sheet / Skeleton / Sonner 等官方组件
- 自研基础件同步替换：toast → vue-sonner（Sonner）、确认框 → AlertDialog、弹窗 → Dialog、表格 → shadcn Table、分页/表单字段/页卡均基于 shadcn 重写；侧边栏与顶栏（用户下拉、语言切换）重构
- 主题使用 shadcn-vue 默认 neutral 变量（`globals.css` 内联，**不保留任何自定义配色文件**，Wise 配色文件已删除）
- `internal/api/security_test.go` 与 CSP 不受影响；15 个后台页面全部重写并通过浏览器实测

### 前台（storefront）

- 移除 daisyUI，改用与后台同一套 **shadcn-vue** 组件；首页搜索/视图切换、商品页（批发表格 / FAQ 手风琴 / 支付方式选择 / Turnstile 弹窗）、订单查询与详情、条款页、初始化页全部重写
- Nuxt 组件目录改为显式导入（`components: false`），避免 index.ts 与 .vue 同名组件重复注册告警
- 主题同样使用 shadcn-vue 默认变量，删除 Wise 配色文件

### 其他

- README（中英双份）技术栈与目录说明同步更新；admin-ui / storefront 依赖清理（daisyui 已移除）
- 结构梳理：后台自研组件移出 `components/ui/`（该目录只保留 shadcn-vue 生成组件），裁剪前后台未使用到的 shadcn 组件目录；README 整体重写并修正 OpenAPI 文件路径描述

## v0.2.2（2026-08-11）— 后台界面迁移 Tailwind CSS + daisyUI

### 后台 UI

- 管理后台从 Element Plus 整体迁移到 **Tailwind CSS 4 + daisyUI 5**（移除 element-plus、unplugin-auto-import / unplugin-vue-components 与 Element 图标依赖）
- 自研轻量 UI 基础件替代 Element Plus：`toast`（右上角消息提示）、`confirm`（确认弹窗）、`Modal`（通用弹窗，不依赖原生 `<dialog>`）、`DataTable`（通用数据表格）、`PaginationBar`、`FormField`、`ProductImage`（占位图兜底）
- 布局重设计：深色可折叠侧边栏（移动端抽屉）、顶栏（语言切换 / 用户菜单 / 退出登录）、页面切换动画；品牌色主题 `liteshop`（emerald 基底，主色贴近商店绿 #0f6b53）
- 全部 15 个后台页面重写：登录、驾驶舱、商品（列表 / 表单 / 卡密）、订单（列表 / 详情）、优惠券、支付、通知、站点、账号（TOTP）、管理员、审计日志、系统
- 原生表单控件（input / select / checkbox / toggle / datetime-local）替代 Element 表单；订单筛选与优惠券有效期改用原生时间选择并统一换算 Unix 秒
- 通知设置页事件模板改为可折叠面板；修复模板数据未加载时的空引用崩溃，补齐 `orders.tradeType` 缺失翻译键
- 驾驶舱图表在数据加载完成后延迟初始化（nextTick），修复首次进入图表不渲染的问题
- README（中英双份）技术栈与目录说明同步更新

### 配色与清理（v0.2.2 增补）

- 主题迁移到 **Wise DESIGN.md**（getdesign.md/wise）配色：暖白画布（#faf9f6）+ 近黑文字（#0e0f0c）+ 酸橙绿主操作（#9fe870，深绿 #163300 文字）+ 薄荷绿/警示黄/危险红语义色；按钮统一胶囊形（9999px 圆角），悬停 scale(1.04) / 按下 scale(0.96)，卡片使用环形阴影
- 字体栈改为 Inter 优先 + 全局 `font-feature-settings: 'calt'`（Wise 排版特征）
- 图标库从 `@element-plus/icons-vue` 换成官方新包 **`@lucide/vue`**（原 lucide-vue-next 已弃用），彻底移除 Element 相关依赖
- 清理 eslint 配置中对已删除自动生成文件的 ignore 条目；代码中不再残留任何 Element Plus 引用（`npm audit` 仍为 AGENTS.md 记录的 js-yaml 构建期基线告警）
- 测试修复：`TestManualDeliveryFlow` 的 SendPaid 断言改为轮询等待（人工发货通知为异步发送，原即时断言在慢速机器上必现失败）

### 前台重构（v0.2.2 增补）

- 前台（storefront）同步升级到 **Tailwind CSS 4 + daisyUI 5**（移除 Tailwind 3 / daisyUI 4 / autoprefixer / postcss 配置与 `tailwind.config.ts`），主题同样切换为 **Wise DESIGN.md** 配色与胶囊按钮风格
- Nuxt 3 升级至最新 3.21.x，新增 `compatibilityDate`；`btn-group` 迁移为 daisyUI 5 的 `join`，清理写死的旧品牌色（含 favicon 与 md-body 渲染样式）
- 安全：后台 CSP 对齐前台策略，放行 Cloudflare 边缘注入的 JS 检测内联脚本（内容含请求级 ray ID，无法用 hash 白名单）与 `static.cloudflareinsights.com` Web Analytics beacon，同步更新 `internal/api/security_test.go`

## v0.2.1（2026-08-11）— 新增 HashPay 支付网关

### 支付

- 新增 [HashPay](https://github.com/TGDash/HashPay) 网关（`internal/payment/hashpay.go`）：创建订单按 `METHOD\npath\ntimestamp\nbody` 原文用商户私钥做 RSASSA-PKCS1-v1_5 SHA-256 签名；回调使用 RSA-OAEP-256+A256GCM 加密信封，解密后按 `status` 处理（paid 发卡 / expired|invalid 关闭订单释放库存），时间戳窗口 ±5 分钟防重放
- 后台支付设置新增**网关切换**（BEpusdt / HashPay）：各自独立配置 Base URL / 商户 ID / 私钥 / 货币 / 回调路径，保存即时生效，无需重启
- HashPay 商户私钥写入 `secrets` 表 AES-GCM 加密存储（留空保持当前密钥，不随 GET 返回明文）
- 幂等台账按网关区分：`processed_events` 键改为 `{gateway}:{trade_id}`，BEpusdt 存量数据前缀不变
- HashPay 回调路由 `/notify/hashpay`（路径可后台配置，动态兜底即时生效）；回调地址在后台支付页展示，便于配置 HashPay 商户 Callback
- HashPay 模式前台隐藏收款类型选项（网络/资产由 HashPay 托管收银台选择），订单按 HashPay 货币记账（默认 USD）

### 双网关并存（v0.2.1 增补）

- 支付网关改为**并存启用**：后台可同时启用 BEpusdt 与 HashPay（`payment_gateway` 存逗号分隔列表，兼容存量单值），前台商品页展示**支付方式选择**（BEpusdt 网络支付 / HashPay 加密支付）
- 订单新增 `payment_gateway` 列（迁移 027）记录所选网关；回调路由各自独立，`processed_events` 幂等键按网关前缀区分，取消/过期按订单网关关闭交易
- 订单法币按所选网关记账（BEpusdt=CNY、HashPay=USD）；HashPay 订单以请求货币作为交易类型（对账用）
- HashPay 取消/过期：协议无商户取消接口，改为主动查询订单状态（`GET /api/order/:orderId`）；未支付等待到期回调兜底，检测到"取消与付款竞态"（已支付）记录订单日志并触发系统异常告警，迟到回调不会误发货

### 测试与文档

- `internal/payment/hashpay_test.go`：RSA 签名原文校验、回调加密信封解密、时间窗/坏信封/未配置错误路径、下单签名与收银台解析
- `internal/api/hashpay_callback_test.go`：真实 HTTP 路由（加密回调 → 发卡 / 过期释放库存 / 坏信封 400 / 动态路径即时生效）+ 重复回调幂等
- OpenAPI 新增 `/notify/hashpay` 与 HashPay 配置字段，admin-ui 类型重新生成（gen:api）
- README（中英双份）新增 HashPay 接入步骤

## v0.2.0（2026-08-09）— 代号：月球 Moon

> 从"能用"走向"工程化"：分层、抽象、可观测性与稳定性全面升级；数据库状态与事件、备份与恢复、代码与文档全部可验证、可回滚。

### 架构与工程化

- 数据库工程化：`internal/db` 收敛为连接层；`schema/` 统一迁移（编号 .sql + 只跑一次）；`repository/` 集中全部 SQL，`Store` 把配置/管理员/会话/审计接口化
- 业务层隔离：handler 只做 HTTP 适配；`service` 六大领域（Order/Product/Admin/Settings/Notify/Stats）；service 只依赖接口，测试可 mock
- 仓储/服务小文件原则：order 仓储按 query/create/state/stats/log 拆分；service 按领域拆小文件（AGENTS.md 固化）
- 领域事件：`internal/events` 类型化事件 + 版本化载荷；`Fanout` 消费者隔离（每消费者独立 goroutine + panic 隔离）
- Outbox 模式：支付成功/发货事件与订单状态**同事务**写 `outbox_events`，worker 发布；连续失败 5 次进 `dead_events`；已发布事件 30 天清理
- 幂等台账：支付回调以网关交易号唯一键登记 `processed_events`（与状态迁移同事务），重复回调零副作用
- 并发库存保护：`_txlock=immediate` + 单条条件 UPDATE 原子锁卡（100 并发抢 1 卡压测通过）
- 事务边界：下单/支付/取消/过期单事务；失败路径原子释放卡密（修复网关建单失败泄漏库存）
- 配置版本：`settings_version` 记录配置结构升级（Laravel 风格步骤），升级不靠猜

### 支付

- `payment.Gateway` 接口抽象，订单业务不绑定 BEpusdt；换网关只需新增适配器
- 回调路径后台可改且**即时生效**（动态兜底路由，无需重启）
- 验签改恒定时间比较

### 稳定性与运维

- 任务系统：worker/调度 panic 隔离、启动补偿、`job_runs` 执行记录（高频任务不记录、7 天清理）
- 备份：`VACUUM INTO` + `integrity_check` 校验（坏文件自动删除）+ 恢复演练测试
- 优雅停机：SIGTERM → 停止接收 → 排空 → worker 退出 → 关库
- 健康指标：/health 返回 database（size/migration_version/last_backup/integrity）+ jobs（queue_size/last_success）
- 日志关联：request_id（X-Request-ID）+ order_id + trace_id，一次支付整线可查
- 数据库连接：WAL + busy_timeout + foreign_keys + immediate
- 限流分级：公共严格、管理 300/min；审计日志三索引

### 安全

- Cloudflare 信任边界：仅对端为 CF 边缘 IP 才采信 `CF-Connecting-IP`
- 管理接口非幂等请求 Origin 同源校验（CSRF 纵深防御）
- 登录锁定按 IP+用户名（防跨 IP 账号锁定 DoS）；失败记录定期清理
- 安全头回归测试（nosniff/X-Frame-Options/CSP/HSTS/Cookie Secure）；前台 CSP
- 依赖基线：Go 1.25.12（govulncheck 全绿）、npm 0 运行时漏洞

### 可观测性与文档

- 组件级健康检查、启动横幅、版本注入（git tag/commit/date）
- OpenAPI 3.0（57 路径，/docs + /swagger，json+yaml）；OpenAPI → TS 类型自动生成（`npm run gen:api`，CI diff 校验）
- 集成测试：MockGateway/NotifyRecorder、支付回调/重复回调/取消/超时/HTTP 验签、并发压测、恢复演练、版本兼容升级

## v0.1.0（此前）— 代号：地球 Earth

> 首个正式版：完整可用的自动发卡系统。

- 前台（Nuxt 3 SSR）：商品列表/详情、Turnstile、下单（BEpusdt 收银台）、订单详情轮询/取消、邮箱找回 + 查看令牌、隐私/条款、SEO（canonical/OG/sitemap/robots）
- 后台（Vue 3 + Element Plus）：仪表盘、商品/卡密/订单/优惠券管理、支付/通知/站点设置、事件模板与测试按钮、维护模式、TOTP 2FA、RBAC + 审计日志、配置备份/恢复/重置
- 后端（Go + SQLite）：BEpusdt 支付对接、zap 三通道日志、编号 .sql 迁移、全接口限流、Turnstile、CSP/HSTS/安全头、CSV 注入防护、SQL 全参数化
- 任务：goroutine + channel 任务总线；订单过期/邮件重试/清理/每日备份
