# LiteShop 代码审计报告（第五轮 · v1.1-v1.4 新功能）

**审计范围**：v1.1 营销包 → v1.4 打磨包（commit `abe4a1e` → `ff0ad8a`，+1993 行）
**审计时间**：2026-08-04
**审计方式**：静态代码审查

---

## 一、本轮新增功能清单

| 功能 | 实现 | 状态 |
|------|------|------|
| 优惠券（固定/百分比） | `internal/order/coupon.go` + `coupons`/`coupon_usages` 表 | ✅ |
| 批发价阶梯折扣 | `WholesaleTier` + `CreateOrder` 数量匹配 | ✅ |
| 商品限购 min/max qty | `CreateOrder` 校验 | ✅ |
| 成本价 + 毛利统计 | `cost_cents` + 仪表盘毛利 | ✅ |
| TOTP 2FA | `internal/security/totp.go`（纯 Go RFC6238） | ✅ |
| 支付回调路径自定义 | `bepusdt_notify_path` setting | ✅ |
| 库存模糊显示 | `stock_display_mode` + `stockText()` | ✅ |
| Webhook HMAC 签名 | `X-LiteShop-Signature` | ✅ |
| 销售报表 API | `/admin/sales-report` + ECharts | ✅ |
| 卡密导出/去重 | `/cards/export` + 导入去重 | ✅ |
| 批量重发邮件 | `/orders/batch-resend` | ✅ |
| 版本 API | `/admin/version` | ✅ |

---

## 二、发现的问题

### 🔴 高危：优惠券在支付失败时不回滚，导致额度被消耗

**文件**：`internal/order/service.go:96-99`

```go
if discount > 0 {
    _ = s.repo.UseCoupon(couponID, order.OrderNo, discount)   // 券用量 +1
    _ = s.repo.AddLog(...)
}
cfg := s.cfg()
// ...
paymentURL, tradeID, err := s.payFn().CreateTransaction(...)  // ← 若此处失败
if err != nil {
    _ = s.repo.SetOrderStatus(order.ID, models.OrderPaymentFailed)
    // ❌ 券没有回滚：used_count 已 +1，但订单支付失败
    return order.OrderNo, "", discount, couponID, err
}
```

**问题**：
- 下单流程：`UseCoupon`（用量+1）→ 创建 BEpusdt 交易。
- 若 BEpusdt 创建交易失败（网络超时/Token 错误），订单进入 `payment_failed`，**券已被标记为已使用**。
- 买家重试下单时同一张券会报"使用次数已用完"，造成资损投诉。
- 同样的问题存在于订单**过期/取消**：`Expire`/`Cancel` 释放卡密但不回滚券用量。

**修复建议**：
```go
// 方案 A（推荐）：支付失败时回滚
if err != nil {
    _ = s.repo.SetOrderStatus(order.ID, models.OrderPaymentFailed)
    if couponID > 0 {
        _ = s.repo.RefundCoupon(couponID)  // used_count - 1
    }
    ...
}

// 方案 B：推迟到支付成功回调再 UseCoupon（更彻底）
// MarkPaidAndDeliver 中再记录券用量
```

同时 `Cancel`/`Expire` 也应回滚：
```go
func (s *Service) Cancel(orderID int64) error {
    ...
    _ = s.repo.ReleaseLockedCards(orderID)
    if o.CouponID > 0 { _ = s.repo.RefundCoupon(o.CouponID) }
    ...
}
```
（需要在 `orders` 表记录 `coupon_id`，目前只有日志，无法关联）

---

### 🟡 中危：TOTP secret 在 `apiAdminTotpStatus` 中明文返回

**文件**：`internal/web/api.go:1488-1493`

```go
func (s *Server) apiAdminTotpStatus(w http.ResponseWriter, r *http.Request) {
    // ...
    _ = s.db.QueryRow(`SELECT totp_enabled, totp_secret FROM admins WHERE id = ?`, id).Scan(&enabled, &secret)
    writeJSON(w, 200, map[string]any{"enabled": enabled, "secret": secret, ...})  // ← 已绑定后也返回 secret
}
```

**问题**：
- 该接口用于"账号"页显示 2FA 状态。但即使 `enabled=true`，也把 `secret` 明文返回给前端。
- 任何能读到该响应的中间人/XSS 都能拿到 TOTP 密钥，进而生成任意验证码，2FA 形同虚设。

**修复建议**：
- 仅在**未启用**（绑定时）返回 secret 用于扫码；已启用后应只返回 `{"enabled": true}`。
```go
resp := map[string]any{"enabled": enabled, "issuer": ...}
if !enabled {
    resp["secret"] = secret  // 仅绑定时需要
}
writeJSON(w, 200, resp)
```

---

### 🟡 中危：2FA 待验证 token 与限流/清理问题

**文件**：`internal/web/api.go:548-555`、`ratelimit.go`

**问题 1 — token 永不过期清理**：
- 2FA 待验证 token 存入 `s.sessions["2fa:"+token]`，5 分钟过期。
- 但 `sessions` map 只在 `currentSession` 被访问时才清理过期项；`2fa:` 前缀的项**永远不会被 `currentSession` 触达**（它查的是登录 session id）。
- 结果：如果用户只输密码不输 OTP，`2fa:` 项将永久驻留内存（轻微内存泄漏 + 可无限累积）。

**问题 2 — `RateLimiter.Cleanup` 从未被调用**：
- `ratelimit.go` 定义了 `Cleanup()`，但没有任何 goroutine 定期调用它。
- `visitors` map 会持续累积 IP 条目（同样轻微内存泄漏）。

**修复建议**：
```go
// NewHandler 中启动一个清理 goroutine
go func() {
    t := time.NewTicker(5 * time.Minute)
    for range t.C {
        s.sessMu.Lock()
        for k, v := range s.sessions {
            if time.Now().After(v.Expiry) { delete(s.sessions, k) }
        }
        s.sessMu.Unlock()
        // 同样清理 rate limiter
    }
}()
```

---

### 🟡 中危：优惠券竞态 —— `used_count` 可超限

**文件**：`internal/order/coupon.go:78-93`

```go
func (r *Repository) UseCoupon(couponID int64, orderNo string, discountCents int64) error {
    // ...
    tx.Exec(`UPDATE coupons SET used_count = used_count + 1 ... WHERE id = ?`, ...)
```

**问题**：
- `GetCouponByCode` 检查 `used_count >= max_uses` 后放行，`UseCoupon` 再 `+1`。
- 两步之间无原子性保证：两个并发请求可同时通过检查，各自 `+1`，导致 `used_count` 超过 `max_uses`。
- 虽然 SQLite 单连接串行化了写，但**读（检查）和写（+1）跨越了两次独立事务**，仍存在 TOCTOU。

**修复建议**：把检查与递增合并为单条原子 SQL：
```go
res, err := tx.Exec(`UPDATE coupons SET used_count = used_count + 1, updated_at = ?
    WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)`, models.Now(), couponID)
// 检查 RowsAffected == 1，否则返回 ErrCouponUsedUp
```

---

### 🟢 低危：`CreateOrder` 金额可为 0，绕过支付

**文件**：`internal/order/service.go:75-80`

```go
amountCents -= discount
if amountCents < 0 {
    amountCents = 0    // ← 订单金额可为 0
}
```

**问题**：大额固定券可把订单金额抵扣到 0。此时仍会调用 BEpusdt 创建 0 元交易（多数网关会拒绝或行为未定义）。
**影响**：测试 `TestCouponAndWholesale` 恰好构造了 `amount=0` 的场景并预期支付失败，说明作者已知。但生产上应直接拦截：0 元订单应直接发卡或拒绝。
**建议**：
```go
if amountCents <= 0 {
    return ..., fmt.Errorf("订单金额需大于 0（抵扣后 %d 分）", amountCents)
}
```
或实现"0 元订单直接发货"逻辑（跳过支付）。

---

### 🟢 低危：`webhook_secret` 无法在后台配置

**文件**：`internal/notify/events.go:73`、`internal/web/api.go:1295`

**问题**：webhook 签名读取 `webhook_secret` setting，但 `apiAdminNotifySave` 只 `setIfPresent("webhook_url", ...)`，没有 `webhook_secret` 的保存入口，后台 UI 也无此字段。该功能**实际不可用**（只能手动写库）。
**建议**：`apiAdminNotifySave` 增加：
```go
setIfPresent("webhook_secret", "webhook_secret")
```
并在 Notify.vue 加输入框。

---

### 🟢 低危：`apiAdminVersion` 注释与实际不符

**文件**：`internal/web/api.go:1923`

注释写"异步检查 GitHub 最新 release"，但实现只返回静态 `Version = "v1.2.0"`，无远程检查。要么实现检查，要么修正注释。

---

## 三、安全审查（新功能面）

| 检查项 | 结果 |
|--------|------|
| TOTP 实现（RFC6238，时钟偏差 ±1 步） | ✅ 正确，`hmac.Equal` 防时序攻击 |
| TOTP secret 生成（20 字节 crypto/rand） | ✅ |
| TOTP 启用前需验 OTP | ✅ 防误绑定 |
| TOTP secret 明文返回（已启用状态） | ❌ 见 🟡 #2 |
| 2FA token 5 分钟过期 + 一次性删除 | ✅ 设计对，但缺清理（见 🟡 #3） |
| 优惠券 SQL 全部参数化 | ✅ |
| webhook HMAC-SHA256 签名 | ✅ 实现正确，但配置缺失（见 🟢 #6） |
| 回调路径自定义合法性校验 | ⚠️ 未校验路径字符（见下） |

**附**：`bepusdtNotifyPath` 直接把 setting 拼进 `mux.HandleFunc("POST "+path, ...)`，若管理员填入非法路径（含空格/通配符）会导致 `http.ServeMux` panic 或路由异常。建议校验 `^/[a-zA-Z0-9/_-]+$`。

---

## 四、测试覆盖评价

| 测试 | 覆盖 |
|------|------|
| `TestCouponAndWholesale` | ✅ 限购校验 + 阶梯价 + 券抵扣 cap + 用量+1 |
| `security/totp_test.go` | ✅ TOTP 生成/验证/时钟偏差 |
| 优惠券过期/用尽/不适用 | ❌ 未覆盖 |
| 优惠券支付失败回滚 | ❌ 未覆盖（因功能缺失） |
| 2FA 完整登录流程 | ❌ 未覆盖 |

---

## 五、修复优先级

| 优先级 | 问题 | 影响 |
|--------|------|------|
| **P0** | 优惠券支付失败/取消不回滚 | 资损 + 客诉 |
| **P0** | 优惠券 used_count 竞态超限 | 资损 |
| **P1** | TOTP secret 已启用后仍明文返回 | 2FA 失效风险 |
| **P1** | 2FA token / rate limiter 内存泄漏 | 长期运行 OOM |
| **P2** | 0 元订单处理 | 支付网关报错 |
| **P2** | 回调路径合法性校验 | 配置错误致 panic |
| **P3** | webhook_secret 配置入口 | 功能不可用 |
| **P3** | version 注释修正 | 文档准确性 |

---

## 六、结论

v1.1-v1.4 新功能**实现完整、测试到位、架构保持一致**，营销/安全/运营三大包均已落地。但**优惠券的资损风险（不回滚 + 竞态超限）是两个必须立即修复的 P0 问题**，TOTP secret 明文返回也需尽快收紧。修复这 4 个点后，新功能可安全上线。

**审计人**：AI Assistant
**报告生成时间**：2026-08-04
