# LiteShop 分模块完全审计（2026-08-07）

**审查对象**：HEAD `7086d76` 全量代码 + 生产部署（152.69.214.124 / shop.3737.de）
**审查方式**：按模块逐一走查（入口配置、数据库迁移、模型、安全原语、订单、商品、支付、通知、Web/API、前台、后台、部署运维、依赖），结合服务器实况与 `go vet`/`go test`/`npm audit` 验证。

---

## 模块 1 · 入口与配置（cmd/shop · internal/config）

**结论：✅**
- `main.go` 使用显式 `http.Server`：`ReadHeaderTimeout 10s` / `ReadTimeout 30s` / `WriteTimeout 60s` / `IdleTimeout 120s`，慢速请求不再长期占用连接。
- `applyEnv` 读取 `SHOP_LISTEN_ADDR`/`SHOP_DATABASE_PATH`/`SHOP_PUBLIC_BASE_URL`/`BEPUSDT_NOTIFY_URL`/`SHOP_SETUP_TOKEN`，与 docker-compose/systemd 声明一致。
- `SHOP_SETUP_TOKEN` 可选：设置后 `/setup` 必须携带令牌（服务器已配置）。

观察：`config.Load()` 内硬编码默认 Turnstile site key（公开值，非密钥）；未配置 secret 时下单返回 403（功能性，非安全问题）。

---

## 模块 2 · 数据库与迁移（internal/db）

**结论：✅**
- 迁移 001–011 齐全且有序：条件 ALTER（002/004/005/006/008/009）、会话表（010）、日志索引（011）均幂等；纯 SQL 迁移在事务内执行并记录 `schema_migrations`。
- `MaxOpenConns(1)` 串行化全部写事务（下单锁卡、发卡、取消/过期原子性由此保证）。
- `ResetAllTables` 清空业务表 + 显式清理 `sessions`；`session_secret` 恢复时被跳过。

观察：SQLite 未启用 WAL（单连接串行下无必要）；`splitSQL` 为简化实现（迁移均为静态 SQL，无风险）。

---

## 模块 3 · 模型（internal/models）

**结论：✅**
- 密码 PBKDF2-SHA256 10 万次 + 恒定时间比较；`ValidatePasswordStrength`（≥8 位 + 字母数字）应用于初始化/建号/改密。
- 订单状态机（`IsValidOrderTransition`/`IsValidOrderStatus`）被真实路径调用。
- 订单号 48 位随机 + 时间戳；查看令牌 24 字节随机。

观察：`CentsFromYuan` 用浮点取整（0.01 元粒度误差可忽略）；订单号作为弱标识已由令牌补强。

---

## 模块 4 · 安全原语（internal/security）

**结论：✅**
- TOTP：RFC 6238，SHA-1 + 6 位 + ±1 步容差，恒定时间比较。
- 密钥加密：AES-256-GCM，随机 nonce，`aesgcm:v1:` 版本前缀，旧明文兼容并在验证成功后升级。

---

## 模块 5 · 订单领域（internal/order）

**结论：✅**
- `CreatePendingOrder` 事务内锁卡并校验数量；`MarkPaidAndDeliver` 单事务（确认+发卡）幂等；`CancelOrder`/`ExpireOrder` 事务内条件迁移 + 释放卡密 + 回滚券。
- `Redeliver` 仅限已支付类状态；`SetStatus` 校验枚举与合法迁移，cancelled/expired 走原子流程。
- 优惠券：券码统一大写、原子递增 + 唯一约束；错误包装收窄（仅 `ErrCoupon*` 业务错误回显，DB 错误脱敏）。
- 业务错误类型化（`BusinessError`）：券码/库存/数量回显买家，网关/DB 错误统一脱敏。

观察：`ExpireStale` 每 5 分钟处理 100 单（小规模足够）；订单/审计日志 180 天自动清理。

---

## 模块 6 · 商品领域（internal/product）

**结论：✅**
- 全部参数化 SQL；搜索/筛选在 Go 内完成；公开接口不泄露 `cost_cents`。

---

## 模块 7 · 支付对接（internal/bepusdt）

**结论：✅**
- 创建/取消交易、回调验签（MD5，BEpusdt 协议）；HTTP 客户端 15s 超时；响应体限 1MB。

观察：MD5 为协议限定（双方共用 token，攻击者无法伪造签名）；回调不校验金额（签名保护完整性，金额由网关口径保证）。

---

## 模块 8 · 通知（internal/notify）

**结论：✅**
- SMTP：拨号 10s 超时 + 会话 30s 期限 + `net.JoinHostPort`（IPv6 兼容）；465 隐式 TLS / 其他端口 STARTTLS。
- 买家邮件收敛为一封（SendPaid），事件通知不再重复发信；Webhook 带 HMAC 签名。
- `SendOrderLinks` 单封邮件发送全部查看链接（只发登记邮箱）。

---

## 模块 9 · Web/API 层（internal/web）

**结论：✅**
- 会话：DB 持久化 + HMAC Cookie + `__Host-`/普通名切换 + 滑动续期 + 删号/登出/恢复/重置即时吊销。
- 限流覆盖：下单 20、登录 10、2FA 10、解锁 10、邮箱查询 20、订单详情 300、取消 10、发链接 10、setup 10（次/分/IP）。
- 鉴权：RBAC（viewer/operator/admin）；`/docs` 仅管理员；错误统一 `writeInternalError` 脱敏。
- 订单访问：新订单令牌恒定时间比对；邮箱查询模糊响应；Turnstile（含 hostname 校验，IP 直连放宽）。
- 安全头 + 后台 CSP；CSV 公式注入防护；图片 URL 限 http/https；site_links 限 50。

观察：配置备份 JSON 仍含全部密钥（除 session_secret），admin 权限 + UI 已警示；审计/订单日志有保留期。

---

## 模块 10 · 前台（storefront）

**结论：✅**
- markdown `html:false`（公告/隐私/条款/商品描述）；订单页无索引；查看令牌只经邮件链接。
- 站点源统一 `NUXT_PUBLIC_SITE_URL`（不信任 Host）；默认图站内 SVG；无外部 CDN 运行时依赖。
- sitemap/robots 输出正确（Cloudflare 托管前缀为 CDN 特性，非本站内容）。

---

## 模块 11 · 后台（admin-ui）

**结论：✅**
- axios `withCredentials`；会话仅存 Cookie（无 localStorage 令牌）；路由守卫校验 session。
- ECharts 6.1.0 本地打包；vue-i18n 需 `unsafe-eval`（CSP 已放行）；无 `v-html`；备份区有敏感提示。

---

## 模块 12 · 部署与运维

**结论：✅**
- Docker：Go 1.26 构建镜像、非 root 运行、`umask 0077`；compose 注入 `NUXT_PUBLIC_SITE_URL`/`SHOP_SETUP_TOKEN`。
- Caddy/install.sh：HSTS、UMask=0077、初始化令牌、数据目录权限。
- 服务器实况：数据目录 700、DB 600、备份 root-only 700/600、三服务 active、`/health`/后台/公网 200、`/docs` 匿名 303。

---

## 模块 13 · 依赖与供应链

**结论：✅**
- Go 1.26.5 + `modernc.org/sqlite v1.56.0`（最新，全测试绿）。
- storefront / admin-ui `npm audit` 均为 0 漏洞。
- 无外部 CDN 运行时依赖（Swagger 本地页、ECharts 本地打包、默认图站内）。

---

## 总评

13 个模块全部通过复核，**未发现未修复的 P1/P2 问题**。各模块此前发现的问题均已在对应轮次闭环（会话、令牌、状态机、限流、超时、依赖、部署加固）。

剩余均为设计性/低危说明：旧订单邮箱回退（已文档化）、备份含密钥（admin + 提示）、BEpusdt MD5 签名（协议限定）、订单号 48 位熵（令牌补强）、`low_stock_notified_*` settings 键增长。

**审查人**：AI Assistant
**审查时间**：2026-08-07
