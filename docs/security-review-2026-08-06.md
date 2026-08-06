# LiteShop 独立安全审查（从零复核）

**审查对象**：HEAD `62acab5`（2026-08-06 全量代码 + 服务器 152.69.214.124 实况）
**审查方式**：不参考此前任何审计报告，按"外部攻击者视角 + 内部越权视角"重新走查全部代码与部署。
**覆盖范围**：Go 后端（web/order/product/db/bepusdt/notify/security）、前台 Nuxt SSR、后台 Vue SPA、迁移脚本、Docker/Caddy/systemd 部署、依赖漏洞（npm audit）、服务器文件权限实况。

> 说明：审查基于静态走查与服务器实况确认；本机无 Go 工具链，但服务器上 `go vet ./...` 与 `go test ./...` 均已通过（部署时已跑）。

---

## 一、结论摘要

未发现可直接远程攻破支付/发卡链路的漏洞（回调验签、下单金额服务端计算、卡密发放原子化均正常）。但发现 **6 个值得优先处理的问题**：1 个公开接口泄露成本价、1 个卡密保护依赖"邮箱可知"的设计缺陷、1 个服务器数据库文件权限过宽、3 个管理端业务逻辑可被误操作造成实质损失（删号后会话残留、手动改状态绕过状态机、对已取消订单补发卡密）。另有依赖供应链、信息泄露、侧信道等中低危项。

---

## 二、P1（高危）

### 🔴 P1-1 公开接口泄露商品成本价

`internal/web/api.go:139` 的 `productJSON` 包含 `cost_cents`，而 `GET /api/v1/products`（列表）与 `GET /api/v1/products/{id}`（详情）均为**无鉴权公开接口**，直接返回该字段。

```go
func productJSON(p models.Product) map[string]any {
	return map[string]any{
		...
		"cost_cents":  p.CostCents,   // ← 公开泄露
		...
	}
}
```

后果：任何人可获知每个商品的成本价与毛利率。这是商业信息泄露，也便于竞品定价。

**修复**：公开接口使用不含 `cost_cents` 的视图（如 `productJSONPublic`），后台接口保留。

---

### 🔴 P1-2 卡密保护完全依赖"邮箱可知"，无所有权证明

`GET /api/v1/orders?contact=<邮箱>` 只要邮箱正确就返回该邮箱全部订单历史（商品、金额、状态、待支付订单的订单号与支付地址），且**无需任何验证**（无验证码、无邮件确认、无限流）。

结合订单详情页：`GET /api/v1/orders/{orderNo}?contact=<邮箱>` 在 contact 匹配时直接返回全部卡密明文。订单号出现在支付跳转 URL、浏览器历史、服务器日志中，一旦与邮箱同时泄露（共享设备、日志、备份），任何人可提取卡密。

这是产品的核心功能设计（README 明确"仅邮箱找回最近订单"），但安全边界薄弱：**卡密=邮箱+订单号两个"弱秘密"**，且邮箱可被枚举探测（接口无 Turnstile、无限流）。

**缓解建议**：
- 为每笔订单生成独立的"查看令牌"（随机 32+ 字节），随支付成功邮件发送；查看卡密/取消要求令牌而非仅邮箱。
- 邮箱查询接口加限流与 Turnstile，并避免返回待支付订单的 `payment_url`。
- 日志与跳转 URL 中去除 contact 明文。

---

### 🔴 P1-3 服务器数据库文件权限过宽（实况确认）

服务器实况（152.69.214.124）：

```
drwxr-xr-x cardshop:cardshop /opt/cardshop/data
-rw-r--r-- cardshop:cardshop shop.db        ← 644，本机任意用户可读
-rw-r--r-- root:root        shop.db.audit13.bak
umask 0022
```

`shop.db` 内含：全部卡密明文、买家邮箱、订单、BEpusdt API Token、SMTP 密码、Telegram Bot Token、Webhook Secret、Turnstile Secret、维护密码、session_secret（可解密同库的 TOTP 密文）。任何能拿到本机低权限 shell 的用户即可完整拖库。

**修复**：
- `chmod 600 /opt/cardshop/data/shop.db*`；目录 `chmod 700`。
- systemd unit 增加 `UMask=0077`（或 `ProtectSystem=strict` + `PrivateTmp`）。
- 备份文件同样收紧权限；旧备份（`shop.db.audit13.bak*`、18MB 的 `shop.bak.*`）迁移到 root-only 目录。

---

### 🔴 P1-4 删除管理员后会话仍有效（降级为 viewer）

`internal/web/server.go` `currentSession`：

```go
var role string
_ = s.db.QueryRow(`SELECT role FROM admins WHERE id = ?`, info.AdminID).Scan(&role)
if role == "" {
	role = models.RoleViewer   // ← 管理员被删后仍按 viewer 放行
}
```

被删除的管理员会话在 12 小时滑动有效期内仍可：读全部订单/卡密、导出 CSV、查看仪表盘与站点配置。角色降级立即生效（每次请求重读），但**删除不生效**。

**修复**：管理员行不存在时 `currentSession` 返回未登录；`apiAdminDeleteAdmin` 删除时同步清除该管理员所有会话（按 `sessionInfo.AdminID` 遍历）。

---

### 🔴 P1-5 手动改订单状态绕过状态机，可锁死库存/伪造支付

`internal/order/service.go` `SetStatus` 只拦截"已支付回退到未支付"，其余任意状态字符串都接受；`apiAdminOrderSetStatus` 也完全不校验枚举。而状态机函数 `models.IsValidOrderTransition` 只被**死代码** `order_state.go` 使用，真实路径未接入。

后果：
- operator 把订单手动置为 `cancelled`/`expired`：**不会释放锁定卡密、不会回滚优惠券** → 库存永久减少（这些卡密无人能释放）。
- 把未支付订单置为 `paid`：报表口径被污染（金额计入销售额的前提是 `paid_at` 存在，但状态已可伪造）。

**修复**：手动状态修改必须走合法迁移表（`IsValidOrderTransition`）；`cancelled`/`expired` 应调用 `Cancel`/`Expire` 原子流程（释放卡密+回滚券）。

---

### 🔴 P1-6 可对已取消/过期订单补发卡密（免费送卡）

`internal/order/service.go` `Redeliver` 只拦截 `payment_failed`：

```go
if o.Status == models.OrderPaymentFailed {
	return fmt.Errorf("订单未支付，无法重新发卡")
}
```

对 `cancelled`/`expired`/`created`/`waiting_payment` 订单，只要当前无卡密，`Redeliver` 会从可用库存补扣并置为 `delivered`——**未付款订单也能拿到卡密**（需要 operator 权限，属高危误操作面）。

**修复**：仅允许 `paid`/`processing`/`delivery_failed`/`delivered`/`completed` 状态补发。

---

## 三、P2（中危）

| # | 问题 | 说明与修复方向 |
| --- | --- | --- |
| 1 | 前端依赖存在已知漏洞 | `npm audit`（storefront 生产依赖）：**nuxt critical**（客户端路径遍历 + `<NuxtLink>` 反射 XSS）、`@nuxt/devtools` critical（开发机 RCE，dev 依赖）、`nitropack` 中度（routeRules 代理绕过）、`serialize-javascript` high（构建期）；admin-ui：**vue-i18n 中度 XSS**。当前代码未直接触发（NuxtLink 的 `:to` 均为服务端构造的安全 URL），但建议 `npm audit fix` + 升级 Nuxt/vue-i18n |
| 2 | 登录存在用户名枚举时间侧信道 | `apiAdminLogin`：用户名不存在时短路跳过 PBKDF2（~百毫秒级差异）。建议对不存在用户也执行一次哈希再做恒定时间比较 |
| 3 | `/docs` Swagger 从 CDN 加载且无 SRI | `api_docs.go` 内联脚本 + jsdelivr 外链；CDN 被攻陷即同源 XSS（可调用管理 API）。建议自托管 swagger-ui 资源并加 SRI |
| 4 | 无 CSP / HSTS | 已有 nosniff/XFO/Referrer/Permissions，但无 Content-Security-Policy 与 Strict-Transport-Security。建议为 SPA 配置 CSP（`/docs` 需例外），Caddy 层加 HSTS |
| 5 | `/setup` 可被抢占 | 未初始化时任何人可完成初始化成为管理员（无任何门槛）。建议支持初始化令牌/一次性环境变量，或部署时预置管理员 |
| 6 | 优惠券大小写不一致 | 创建时 `strings.ToUpper`，下单查询不转换 → `save10` 查不到 `SAVE10`（功能缺陷） |
| 7 | 邮箱订单查询接口无限流、无验证 | 可用于探测邮箱是否有订单（配合 P1-2）。建议限流 + Turnstile |
| 8 | 维护密码明文存储、cookie 为裸 SHA-256 | `maint_unlock` cookie = `sha256(password)`，无服务器密钥参与，泄露后可在离线爆破；settings 表明文存储。建议 HMAC(server_secret, password) + 存储哈希 |

---

## 四、P3（低危/观察项）

1. **错误信息回显**：多处 500 直接返回 `err.Error()`（如 `apiAdminProductCreate`、`apiAdminOrders`），可能泄露 SQL/路径细节。建议统一"内部错误"文案，详情写日志。
2. **Session Cookie 可加 `__Host-` 前缀**：当前 `shop_session` 无前缀（需配合 Secure + Path=/ + 无 Domain，条件已满足）。
3. **备份文件包含全部密钥明文**：`/api/v1/admin/system/backup` 导出的 JSON 含 BEpusdt Token、SMTP 密码、Telegram Token、Webhook Secret、session_secret 等。建议备份前加密/最小化，并提示妥善保管。
4. **`apiAdminSetRole`"最后一个管理员"检查非原子**：并发两次降级可清零 admin（低概率）。建议放入事务。
5. **登录/新建管理员密码仅长度限制**：无复杂度要求；建议至少 8 位 + 混合字符。
6. **邮箱明文出现在跳转 URL**：`redirect_url` 与订单页 URL 携带 `?contact=`，会进浏览器历史/服务器日志（与 P1-2 缓解相关）。
7. **`/docs` 公开暴露全部 API 面**：信息收集便利；如需可加访问控制。
8. **前端默认商品图指向第三方 CDN**（`storage.moegirl.org.cn`）：隐私与可用性依赖第三方，建议改为站内默认图。
9. **环境变量实际未读取**：`config.Load()` 不读 env，docker-compose/systemd 里的 `SHOP_*`、`BEPUSDT_NOTIFY_URL` 均为摆设，全靠默认值 + WorkingDirectory 工作（当前能跑，但配置误导性强）。
10. **部署目录堆积**：`/opt/cardshop` 下约 13 个 18MB 的 `shop.bak.*` 二进制备份、`/opt/liteshop-storefront.old-*`；建议建立清理策略并收紧目录权限。
11. **发卡通知同步阻塞回调响应**：`MarkPaidAndDeliver` 内同步发邮件/Telegram，可能拖慢 BEpusdt 回调应答（幂等兜底存在，但建议异步+队列）。
12. **订单号熵 48 位作为类凭证**：结合 P1-2 的查看令牌方案一并解决。
13. **硬编码默认 Turnstile site key**：非官方测试 key；未配置 secret 时下单必 403（功能性，非安全）。
14. **手动 `SetStatus` 的 message 未限制长度**：可写超大文本（DB 膨胀，低危）。

---

## 五、重新验证通过的部分（正面结论）

- **SQL 注入**：全部参数化；`ListOrders` 仅拼接 where 片段，参数占位符。
- **支付回调**：MD5 验签（BEpusdt 协议）、`MarkPaidAndDeliver` 单事务（状态迁移+发卡）、重复回调幂等。
- **超卖/优惠券**：`MaxOpenConns(1)` 串行化事务；`CreatePendingOrder` 事务内锁卡校验数量；`UseCoupon` 原子递增 + 唯一约束。
- **存储型 XSS**：markdown-it `html:false`；Vue/Nuxt 默认转义；admin-ui 无 `v-html`。
- **凭据处理**：PBKDF2-SHA256 10 万次 + 恒定时间；TOTP AES-GCM 加密、一次性 2FA 令牌；登录/验证/下单/解锁均限流。
- **CSRF**：变更接口均 POST + JSON + `SameSite=Lax`。
- **已确认生效的近期修复**：取消订单需 contact、详情未验证归属不下发邮箱/支付地址、取消/过期/发卡原子化、Secure Cookie（X-Forwarded-Proto）、维护密码不再明文返回、设置保存校验、通知路径冲突防护、回调日志脱敏。
- **构建/测试**：服务器上 `go vet ./...`、`go test ./...` 全绿；三服务运行正常。

---

**审查人**：AI Assistant
**审查时间**：2026-08-06
