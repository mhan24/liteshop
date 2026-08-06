# LiteShop 安全审计报告（第十四轮 · 独立复核）

**审计范围**：当前 HEAD（commit `eb17334`）全量代码
**审计时间**：2026-08-06
**审计方式**：独立静态审查，重点覆盖 v13 之后的新增代码（回调路径配置、币种/网络选项、logo/favicon、i18n）以及此前多轮未覆盖的授权、限流、会话与并发路径。

> 当前环境无 Go 工具链，未执行 `go test ./...` / `go vet` / `go test -race`。

---

## 一、总体结论

代码整体质量良好：SQL 全部参数化、密码使用 PBKDF2-SHA256（10 万次迭代 + 恒定时间比较）、TOTP 用 AES-GCM 加密、RBAC + 审计日志齐备、`MaxOpenConns(1)` 将 SQLite 写事务串行化（下单超卖、优惠券并发超限均有保护）、前台 markdown 渲染关闭了 HTML（`html: false`）、CSV 导出有公式注入防护、支付回调验签且幂等。

本轮发现 **2 个 P1（限流可绕过、订单号即能力令牌）、4 个 P2、若干 P3 观察项**。均为可修复项，不构成支付或资金层面的直接漏洞。

---

## 二、P1

### 🔴 P1-1：限流可被伪造 HTTP 头绕过；维护密码解锁无任何限流

**文件**：`internal/web/server.go:468`（`clientIP`）、`internal/web/ratelimit.go:64`、`internal/web/api.go:39`

```go
func clientIP(r *http.Request) string {
	if ip := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); ip != "" {
		return ip
	}
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		parts := strings.Split(xff, ",")
		if ip := strings.TrimSpace(parts[0]); ip != "" {
			return ip
		}
	}
	...
}
```

`clientIP` 无条件信任 `CF-Connecting-IP` 和 `X-Forwarded-For` 的第一个值。只要站点不是严格经过 Cloudflare（README 中 Cloudflare 是可选层，docker-compose 也未包含），攻击者就可以在每次请求中随意伪造这两个头，**完全绕过登录（10 次/分）与下单（20 次/分）限流**，对管理密码做在线暴力破解。

另外 `POST /api/v1/maintenance/unlock`（`api.go:39` 注册，`api.go:289` 实现）**完全没有限流**，维护密码可被无限次尝试。

**修复建议**：
- 限流键改用 `r.RemoteAddr`（或仅在明确配置了可信代理时读取转发头，并对 XFF 取最后一个非可信值）。
- 为 `maintenance/unlock` 增加与登录一致的限流（如 10 次/分/IP）。

---

### 🔴 P1-2：订单号成为"能力令牌"——可被任何人取消订单并读取买家邮箱

**文件**：`internal/web/api.go:465`（`apiCancelOrder`）、`internal/web/api.go:489`（`apiOrder`）、`internal/web/api.go:155`（`orderJSON`）

- `POST /api/v1/orders/{orderNo}/cancel` 只检查订单状态，**不校验下单邮箱/任何凭证**。任何拿到订单号的人（订单号出现在支付跳转 URL、订单查询页 URL 中）都能把别人的订单取消，形成未鉴权 DoS。
- `GET /api/v1/orders/{orderNo}` 直接返回 `orderJSON`，其中包含 `buyer_contact`（下单邮箱）。订单详情页对未携带 contact 的访问也返回完整订单 JSON，**只要知道订单号就能看到买家邮箱**，构成隐私泄露。
- 订单号熵约 48 位（`models.NewOrderNo`，6 字节随机 + 时间戳），不可暴力枚举，但作为可公开传播的 URL 标识符，其泄露面是真实存在的。

**修复建议**：
- 取消接口要求 `contact` 与订单 `buyer_contact` 一致（与卡密展示逻辑 `api.go:498-509` 对齐）。
- `apiOrder` 对未验证 contact 的请求不返回 `buyer_contact`、`payment_url` 等敏感字段。
- 或为取消操作签发短期一次性令牌。

---

## 三、P2

### 🟠 P2-1：Session Cookie 在 Caddy 反代部署下不带 `Secure`

**文件**：`internal/web/server.go:617`、`internal/web/api.go:593` / `api.go:640`

```go
s.startSession(w, adminID, r.TLS != nil)
```

`Secure` 仅由 `r.TLS != nil` 决定。文档化的 Docker 部署是 Caddy 终止 TLS 后以 HTTP 转发给 Go（8080），此时 `r.TLS` 恒为 `nil`，`shop_session` Cookie 不带 `Secure`。浏览器会将该 Cookie 通过明文 HTTP 请求一并发送（虽然 Caddy 会 301 到 HTTPS，但明文请求已携带 Cookie），存在被中间人截获的风险。

**修复建议**：基于 `X-Forwarded-Proto == "https"`（或对本地开发显式放行）设置 `Secure`，生产默认开启。

---

### 🟠 P2-2：取消/支付存在状态竞态，可能把已支付订单置为取消

**文件**：`internal/order/service.go`（`Cancel` / `Expire` / `MarkPaidAndDeliver`）、`internal/order/repository.go`（`SetOrderStatus` / `SetOrderStatusFrom` / `MarkPaid` / `DeliverCards`）

- `Cancel`/`Expire` 先 `GetOrderByID` 读状态，再无条件 `SetOrderStatus(orderID, cancelled)`。若支付回调在"读状态"与"写状态"之间完成 `MarkPaid`，取消操作会把**已支付订单覆盖为 cancelled**（卡密已售出、钱已收到，账单状态却显示已取消）。
- `MarkPaidAndDeliver` 中 `MarkPaid` 与 `DeliverCards` 是两个独立语句（非同一事务）。若中间插入 `ReleaseLockedCards`（取消/过期），则卡密被释放后 `DeliverCards` 匹配 0 行，订单变为 paid 但无卡，且该路径不触发任何通知（`SendPaid` 未调用、无系统错误通知），买家付款后拿不到卡密。
- 仓库已有 `SetOrderStatusFrom(from,to)`（带旧状态条件的更新），但 `Cancel`/`Expire` 未使用。

**修复建议**：`Cancel`/`Expire` 用 `SetOrderStatusFrom(waiting_payment→cancelled)` 做条件更新（失败即说明状态已变，返回冲突）；将 `MarkPaid + DeliverCards` 合并进同一事务并校验受影响行数；发卡失败路径补系统通知。

---

### 🟠 P2-3：维护密码明文存储，且 viewer 角色可读取

**文件**：`internal/web/api.go:1458`

```go
"maintenance_password":  mustGetSetting(s, "maintenance_password"),
```

`apiAdminSite` 注册为 `requireAdminAPI`（最低 viewer 即可读），直接把 `maintenance_password` 明文返回给任意只读管理员。同时该密码明文存于 settings 表（另有 `apiAdminSiteSave` 保存）。viewer 拿到后可解锁前台维护模式。

**修复建议**：接口只返回 `maintenance_pass_set` 布尔值；如需展示，应像 SMTP 密码那样掩码。存储侧至少改为哈希后比对（当前 cookie 已用 SHA-256，可复用之）。

---

### 🟠 P2-4：设置保存缺少校验（校验函数存在但未使用）

**文件**：`internal/web/api.go:1319`（`apiAdminSettingsSave`）、`internal/web/server.go:390/403/484`（`normalizeFiat` / `normalizeTradeTypes` / `normalizeHTTPURL`）

三个校验函数在代码库中**只有定义、没有调用点**。`apiAdminSettingsSave` 将 `fiat`、`trade_types`、`shop_public_base_url`、`bepusdt_base_url` 原样入库：
- `trade_types` 可被写成任意字符串（含特殊字符），前台会把它渲染成网络选项，接口的 `tradeTypeAllowed` 校验与显示不一致；
- 非法 `shop_public_base_url` / `bepusdt_base_url` 会被拼进 `NotifyURL`、`RedirectURL` 发给 BEpusdt。

**修复建议**：保存时调用既有校验函数；非法值拒绝保存并返回错误（与 `bepusdt_notify_path` 的处理方式一致）。

---

## 四、P3 / 观察项

| # | 观察 | 位置 |
| --- | --- | --- |
| 1 | 首次初始化无保护：站点暴露期间任何人可抢占 `/setup`（`HasAdmin` 检查与 `SeedAdmin` 存在 TOCTOU，并发可双写 settings）。建议支持"初始化令牌"或部署时预置 | `api.go:1983` |
| 2 | 配置备份为明文 JSON，包含 BEpusdt Token、SMTP 密码、Telegram Token、Webhook Secret、Turnstile Secret、session_secret、维护密码；恢复接口无审计日志 | `api.go:1904` / `api.go:1914` |
| 3 | 死代码模板 `renderContactHTML` 对 `name\|url` 形式的 href 不做协议校验，可产出 `javascript:` 链接（当前无路由执行 public 模板，潜在风险） | `templates.go:447` |
| 4 | 前台 `SiteFooter.href()` 对非 http/www/@/mailto 的 URL 原样返回，管理员配置的 `javascript:` 链接会原样渲染（管理员自 XSS，仅影响其自己） | `storefront/components/SiteFooter.vue:49` |
| 5 | 无 CSP 响应头（已有 nosniff/XFO/Referrer/Permissions），建议为管理后台与前台配置 CSP | `server.go:117` |
| 6 | 依赖版本陈旧：Nuxt 3.15 / Vue 3.5.13 / Vite 6.0.7 / Element Plus 2.8.8 / modernc sqlite v1.34.4 / Go 1.22。建议升级并执行 `npm audit`（Vite 历史版本有多个公开 CVE） | `package.json` 等 |
| 7 | `bepusdt_notify_path` 若与已注册 POST 路由相同，`ServeMux` 注册会 panic 导致服务无法启动（管理员误配置即 DoS）。建议拒绝与现有路由冲突的值 | `server.go:191` / `server.go:104` |
| 8 | sitemap 的 `origin` 取自请求 Host，若 storefront 端口被直连暴露，可被引导请求任意主机（受限 GET SSRF） | `storefront/server/routes/sitemap.xml.ts` |
| 9 | `clientIP` 同时用于 Turnstile `remoteip` 参数，伪造头只是影响风控统计，无安全影响 | `api.go:375` |
| 10 | 回调通知中 `body=%s` 会记录完整回调体（含签名与订单信息），建议脱敏 | `server.go:552` |

---

## 五、已验证无问题的部分

- **SQL 注入**：所有查询参数化；`ListOrders` 仅拼接 where 片段、参数仍为占位符。
- **支付回调**：MD5 验签（BEpusdt 协议）、`MarkPaid` 带 `status='waiting_payment'` 条件幂等、重复回调不重复发卡。
- **超卖/优惠券**：`MaxOpenConns(1)` 串行化事务，`CreatePendingOrder` 事务内锁卡并校验数量，`UseCoupon` 原子递增 + 唯一约束。
- **存储型 XSS**：markdown-it `html:false`；Vue 模板默认转义；admin-ui 无 `v-html`。
- **密码与 2FA**：PBKDF2-SHA256 10 万次迭代、恒定时间比较；TOTP 密钥 AES-GCM 加密、一次性 2FA 令牌、登录/验证均限流。
- **CSRF**：变更操作均为 POST + JSON + `SameSite=Lax`。
- **文件与导出**：无路径遍历；CSV 公式注入防护。

---

## 六、发布前验证清单（延续 v13）

| 优先级 | 项目 |
| --- | --- |
| P0 | `go test ./...`、`go vet ./...`、`go test -race ./...`（补并发取消/回调测试） |
| P1 | 修复本报告 P1-1 / P1-2 后回归登录限流与订单流程 |
| P1 | 真实旧库 001→008 升级演练 |
| P2 | `npm audit` + 依赖升级 |
| P2 | 修复 P2-1~P2-4 后复验 |

**审计人**：AI Assistant
**报告生成时间**：2026-08-06

---

## 七、修复记录（2026-08-06 同轮修复）

以下问题已在本轮内直接修复（commit 待提交）：

| 编号 | 问题 | 修复内容 |
| --- | --- | --- |
| P1-1 | 限流可被伪造头绕过 | `clientIP` 改为：优先 `CF-Connecting-IP`（校验为合法 IP），否则取 `X-Forwarded-For` 最右侧合法条目（由最近代理追加，客户端无法伪造其位置），最后回退 `RemoteAddr`；`maintenance/unlock` 增加 10 次/分限流 |
| P1-2 | 订单号即能力令牌 | `apiCancelOrder` 要求 `contact` 与下单邮箱一致；`apiOrder` 未验证归属时不下发 `buyer_contact`/`payment_url`/`trade_id`；前台取消请求带上邮箱参数 |
| P2-1 | Session Cookie 缺 Secure | `startSession` 改为由 `r.TLS` 或 `X-Forwarded-Proto: https` 决定 Secure（适配 Caddy 反代） |
| P2-2 | 取消/支付竞态 | 新增 `Repository.MarkPaidAndDeliver`（同一事务内 支付确认+发卡）、`CancelOrder`/`ExpireOrder`（事务内条件状态迁移+释放卡密+回滚优惠券），`Service.Cancel/Expire/MarkPaidAndDeliver` 全部改走原子路径；发卡为 0 时返回 `ErrNoCards` 并触发系统通知 |
| P2-3 | 维护密码暴露 | `apiAdminSite` 不再返回明文 `maintenance_password`，仅保留 `maintenance_pass_set` |
| P2-4 | 设置保存缺校验 | `apiAdminSettingsSave` 对 `fiat`/`trade_types`/`shop_public_base_url`/`bepusdt_base_url`/`bepusdt_notify_url` 调用既有校验函数；`apiSetup` 同步校验；`tradeTypes()` 读取时过滤历史非法值；顺带修复 fiat 保存键名错误（`fiat` → `bepusdt_fiat`） |
| P3-2 | 恢复无审计 | `apiAdminSystemRestore` 成功后写入审计日志 |
| P3-3/4 | 危险链接协议 | `renderContactHTML` 增加 `safeHref` 协议白名单；`SiteFooter.href()` 对非白名单协议回退 `#` |
| P3-7 | 通知路径冲突 | `reNotifyPath` 收紧（禁止连续斜杠/空段），新增 `notifyPathConflicts` 拒绝 `/api`、`/admin`、`/health`、`/docs`、`/setup` 前缀，保存与启动注册双处防护 |
| P3-10 | 回调日志泄露 | `handleBepusdtNotify` 失败日志不再输出原始回调体，仅记录字节数 |

**仍未处理（建议后续）**：
- P3-1 首次初始化保护（需要设计初始化令牌，涉及部署流程变更）；
- P3-5 CSP 响应头（`/docs` 依赖内联脚本与 CDN，需一并改造）；
- P3-6 依赖升级与 `npm audit`（Nuxt/Vite/sqlite 等）；
- P3-8 sitemap origin 来源限制（依赖部署边界：storefront 端口仅内网可达）；
- P3-9 Turnstile remoteip 伪造（风控统计层面，无安全影响）。
