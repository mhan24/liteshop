# LiteShop 第二轮独立安全审查（完全从零）

**审查对象**：HEAD `5eaf046`（2026-08-06，含第一轮修复 + 代码瘦身）
**审查方式**：不参考此前任何报告，按攻击者视角重新走查当前全部代码、迁移、前端、部署与服务器实况，并重点复核上一轮修复是否引入新问题。
**验证环境**：服务器 152.69.214.124（Ubuntu 22.04 aarch64，systemd + Caddy，域 shop.3737.de），`go vet` / `go test` 全绿，三服务正常。

---

## 一、总体结论

第一轮 P1/P2 绝大多数已修复并生效（成本价不再泄露、状态机收紧、删除账号吊销会话、登录时序均摊、依赖 0 漏洞、数据库权限 600/700、UMask、HSTS 等）。瘦身未造成功能回归（编译/测试/线上全部通过，无硬编码密钥）。

但本轮发现 **2 个由上一轮修复引入的 P1 级缺陷**，需要优先处理：

1. **订单查看令牌可经"邮箱查询"接口被套取**——知道买家邮箱的攻击者可以在订单待支付时拿到令牌，等买家付款后直接取走卡密；
2. **`__Host-` Cookie 在纯 HTTP 部署下会被浏览器整体拒绝**——管理员无法登录（影响 SKIP_SSL=1 / 本地 HTTP 环境）。

另有若干 P2/P3（含上轮遗留的优惠券大小写问题）。

---

## 二、P1（本轮新发现）

### 🔴 P1-1：查看令牌可经邮箱查询接口被套取（上轮令牌方案存在绕过）

`internal/web/api.go:466`：

```go
viewURL := "/order/" + o.OrderNo
if o.ViewToken != "" {
	viewURL += "?token=" + o.ViewToken   // ← 待支付订单的令牌直接返回给"知道邮箱"的人
} else {
	viewURL += "?contact=" + url.QueryEscape(contact)
}
```

`GET /api/v1/orders?contact=<邮箱>` 对 `waiting_payment` / `created` / `cancelled` / `expired` 订单返回带 **查看令牌** 的完整 URL。攻击流程：

1. 得知受害者邮箱（泄露、枚举、共享设备）；
2. 在受害者下单后、付款前调用邮箱查询，拿到 `order_no + token`；
3. 受害者付款后，攻击者用 `token` 请求 `GET /api/v1/orders/{order_no}?token=...`，直接取走全部卡密。

令牌本应只通过"发给该邮箱的邮件链接"传递，现在却由无主查询接口主动下发，等于把"邮箱可知"重新变成"卡密可知"。

**修复方向**：
- 邮箱查询接口对 token 化订单**不返回**带令牌的 URL（只展示订单摘要）；
- 提供"向下单邮箱重发查看链接"的接口（令牌只发往订单登记的邮箱），替代直接下发；
- 或对令牌查询增加一次性的"取卡密需同时匹配邮箱 + 令牌"双重校验。

---

### 🔴 P1-2：`__Host-` Cookie 在纯 HTTP 部署下导致管理员无法登录（上轮修复引入回归）

`internal/web/server.go` `startSession`：

```go
secure := r.TLS != nil || strings.EqualFold(strings.TrimSpace(r.Header.Get("X-Forwarded-Proto")), "https")
http.SetCookie(w, &http.Cookie{Name: "__Host-shop_session", ..., Secure: secure, ...})
```

按 Cookie 规范，**`__Host-` 前缀的 Cookie 必须携带 `Secure`**，否则浏览器会整体拒绝该 Set-Cookie。当部署为纯 HTTP（install.sh `SKIP_SSL=1`、本地 `go run` 开发）时 `secure=false`，`__Host-shop_session` 永远不会被写入，管理员登录无限失败。

**修复方向**：`secure=false` 时回退到普通名称（如 `shop_session`）并保持 `HttpOnly + SameSite=Lax`；HTTPS 环境继续用 `__Host-` 前缀。

---

## 三、P2（中危 / 功能缺陷）

| # | 问题 | 位置与说明 |
| --- | --- | --- |
| 1 | 优惠券大小写不一致 | 创建时 `strings.ToUpper`，下单查询原样传入 → `save10` 无法使用 `SAVE10`。`internal/order/service.go:100`。上轮计划修复未落地 |
| 2 | `SetStatus('expired')` 对已支付订单**静默成功** | `Expire` 对不允许的状态返回 `nil`，`SetStatus` 直接透传 → API 返回 200 但无任何变化，与 `cancelled` 返回 400 的行为不一致。`internal/order/service.go` `Expire`/`SetStatus` |
| 3 | 邮箱枚举面仍在 | 邮箱查询接口已限流（20/分/IP），但仍能通过"有无订单列表"探测邮箱是否在该站下过单，且无 Turnstile |
| 4 | `/docs` 公开完整 API 面 | Swagger 已加 SRI 固定版本，但接口文档仍任何人可读，便于信息收集 |
| 5 | 备份 JSON 明文含全部密钥 | BEpusdt Token、SMTP/Telegram/Webhook Secret、session_secret 等随下载（admin 权限） |
| 6 | 密码策略宽松 | 登录/新建管理员仅长度 ≥8，无复杂度要求 |
| 7 | 维护密码存量明文不自动升级 | 旧明文在解锁成功后不回写为哈希（新保存已哈希） |
| 8 | `/setup` 并发竞态 | 两个并发请求可同时通过 `HasAdmin` 检查后双写 settings（初始化令牌可缓解，但未强制） |

---

## 四、P3 / 观察项

1. 环境变量大多未被读取：`SHOP_LISTEN_ADDR`、`SHOP_DATABASE_PATH`、`BEPUSDT_NOTIFY_URL` 等在 docker-compose/systemd 里是摆设（仅新增的 `SHOP_SETUP_TOKEN` 被 main.go 读取）。
2. sitemap 的 `origin` 取自 Host（storefront 端口被直连暴露时才有意义，低风险）。
3. 默认商品图指向第三方 CDN（`storage.moegirl.org.cn`），可用性/隐私依赖第三方。
4. 订单号熵 48 位仍作为 URL 标识（新订单已由令牌补强，旧订单仍依赖邮箱）。
5. 会话内存态：服务重启全员下线（设计如此，非缺陷）。
6. 服务端残留早期 DB 备份（`shop.db.audit13.bak*`、`pre-v14/v15`，均已 600 权限，建议归档到 root-only 目录或清理）。
7. CSP 仅覆盖 `/admin`，且未经真实浏览器回归测试（若 Element Plus/md-editor 有内联脚本需微调）。
8. 硬编码默认 Turnstile site key：未配置 secret 时下单必 403（功能性）。
9. 发送通知在支付回调路径内同步执行（邮件/Telegram 慢时会拖慢 BEpusdt 应答）。

---

## 五、已验证通过（正面结论）

- **第一轮修复复核**：成本价不泄露（公开接口 0 处 `cost_cents`）；新订单凭令牌访问；删除管理员即时吊销会话；手动改状态走状态机；补发仅限已支付类状态；登录时序均摊；维护密码哈希存储；错误统一 `writeInternalError`；限流覆盖下单/登录/邮箱查询/解锁；依赖 0 漏洞（npm audit）。
- **瘦身复核**：删除死模板/死代码/旧审计文档后 `go build`、`go vet`、`go test ./...` 全部通过；线上 `/health`、后台、公网首页 200；`chooseLang` 行为保持（读 lang Cookie）。
- **安全基线**：SQL 全参数化；PBKDF2-SHA256 10 万次 + 恒定时间；TOTP AES-GCM 加密 + 一次性令牌；支付回调 MD5 验签且 `MarkPaidAndDeliver` 单事务幂等；`MaxOpenConns(1)` 串行化写事务；markdown `html:false`；CSV 公式注入防护；`SameSite=Lax` + `HttpOnly`。
- **服务器实况**：`/opt/cardshop/data` 700、`shop.db` 600、systemd `UMask=0077`、Caddy HSTS 生效、无硬编码密钥入库。

---

**审查人**：AI Assistant
**审查时间**：2026-08-06
