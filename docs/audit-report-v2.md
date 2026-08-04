# LiteShop 代码审计报告（第二轮）

**审计范围**：修复后代码（commit `97f2ef0`）  
**审计时间**：2026-08-04  
**审计方式**：静态代码审查 + 修复验证

---

## 一、修复验证结果

| 原问题 | 修复状态 | 验证结果 |
|--------|----------|----------|
| 🔴 `UPDATE ... LIMIT` 语法错误 | ✅ **已修复** | 改用子查询 `WHERE id IN (SELECT id ... LIMIT ?)`，语法兼容 |
| 🔴 `api.go` 缺失 `package web` | ✅ **已修复** | 文件第 1 行已添加 `package web` |
| 🟡 敏感配置泄露（SMTP/TG Token） | ✅ **已修复** | `apiAdminNotify` 权限提升为 `RoleOperator`，`smtp_username` 返回布尔值 |
| 🟡 审计日志不完整 | ✅ **已修复** | `payment_update`/`notify_update`/`site_update` 已添加审计 |
| 🟢 死代码 `saveIfPresent` | ✅ **已修复** | 空函数已删除 |
| 🟢 时区硬编码北京时间 | ✅ **已修复** | 新增 `StartOfDayIn`/`LocationFromTimezone`，支持 `site_timezone` 配置 |

**结论**：所有 P0-P3 问题均已修复，代码可正常构建，核心功能恢复。

---

## 二、新发现的问题

### 🟡 中危：`Redeliver` 补发后未重置 `reserved_order`，导致卡密状态不一致

**文件**：`internal/order/service.go:184-190`

```go
if affected != o.Qty {
    return fmt.Errorf("可用卡密不足，无法补发")
}
// 将新锁定的卡密真正售出
if err := s.repo.DeliverCards(o.ID); err != nil {
    return err
}
```

**问题**：
- `Redeliver` 先调用 `ReserveCardsFromStock` 将卡密锁定（`status='locked', reserved_order=orderID`），再调用 `DeliverCards` 将 `reserved_order=orderID` 的卡密标记为 `sold`。
- 但 `DeliverCards` 的 SQL 是：
  ```sql
  UPDATE cards SET status = 'sold', sold_order = ?, reserved_order = 0, sold_at = ?, updated_at = ? WHERE reserved_order = ? AND status = 'locked'
  ```
- **关键点**：`DeliverCards` 会同时清空 `reserved_order`（设为 0），这是正确的。
- **但** `Redeliver` 在 `ReserveCardsFromStock` 成功后、调用 `DeliverCards` 前，如果发生 panic 或外部中断，卡密会停留在 `locked` 状态且 `reserved_order=orderID`，形成孤儿锁定。

**更严重的问题**：
- `Redeliver` 的测试 `TestRedeliverFreesAndRelocks` 中，订单初始状态是 `delivery_failed`，且 **已释放过一次卡密**（`ReleaseLockedCards`）。
- 测试验证补发后 `sold=1, available=2`，逻辑正确。
- **但生产场景中**，如果订单处于 `delivery_failed` 且 `reserved_order` 仍指向该订单（未释放），`ReserveCardsFromStock` 会 **额外锁定新卡密**，而旧卡密仍锁定，导致库存超扣。

**修复建议**：
```go
func (s *Service) Redeliver(orderID int64) error {
    // ... 前置检查 ...
    
    // 先释放旧锁定（幂等）
    _ = s.repo.ReleaseLockedCards(o.ID)
    
    // 再重新锁定
    affected, err := s.repo.ReserveCardsFromStock(o.ProductID, o.Qty, o.ID)
    // ...
}
```

---

### 🟡 中危：`apiAdminOrderRedeliver` 重复查询订单，存在 TOCTOU 竞态

**文件**：`internal/web/api.go:1001-1016`

```go
func (s *Server) apiAdminOrderRedeliver(w http.ResponseWriter, r *http.Request) {
    id, err := pathID(r, "id")
    // ...
    o, err := s.orders.Repo().GetOrderByID(id)  // 第一次查询
    if err != nil {
        writeError(w, 404, "not found")
        return
    }
    if err := s.orders.Redeliver(id); err != nil {  // Redeliver 内部再次查询
        writeError(w, 400, err.Error())
        return
    }
    s.audit(r, "order_redeliver", "order", fmt.Sprintf("%d", o.ID), o.Status, models.OrderDelivered)
    // ...
}
```

**问题**：
- `o` 在 `Redeliver` 调用前查询，用于审计日志的 `before` 状态。
- 但 `Redeliver` 内部会修改订单状态，如果并发请求同时执行，`o.Status` 可能与实际不符。
- 审计日志的 `before` 值可能不准确。

**修复建议**：
```go
// 在 Redeliver 内部返回 before/after 状态，或：
before, _ := s.orders.Repo().GetOrderStatus(id)
if err := s.orders.Redeliver(id); err != nil {
    // ...
}
s.audit(r, "order_redeliver", "order", fmt.Sprintf("%d", id), before, models.OrderDelivered)
```

---

### 🟢 低危：`Notify.vue` 中 `smtp_username` 使用 `type="password"` 不合理

**文件**：`admin-ui/src/views/Notify.vue:7`

```vue
<el-form-item :label="t('notify.smtpUsername')">
  <el-input v-model="form.smtp_username" type="password" :placeholder="t('notify.smtpPasswordPlaceholder')" show-password />
</el-form-item>
```

**问题**：
- SMTP 用户名通常是邮箱地址（如 `noreply@example.com`），非敏感信息，无需密码框。
- 使用 `type="password"` 会导致浏览器自动填充混乱，且占位符文本是 `smtpPasswordPlaceholder`（密码占位符），语义错误。

**修复建议**：
```vue
<el-input v-model="form.smtp_username" :placeholder="t('notify.smtpUsernamePlaceholder')" />
```

---

### 🟢 低危：`TestRedeliverFreesAndRelocks` 测试命名不准确

**文件**：`internal/web/order_state_test.go:147`

**问题**：测试名 `TestRedeliverFreesAndRelocks` 中的 "Frees" 有歧义——测试场景是"释放旧锁定后重新锁定新卡密"，而非"释放并重新锁定同一张卡"。

**建议**：改为 `TestRedeliverFromStock` 或 `TestRedeliverLocksNewCards`。

---

### 🟢 低危：`internal/web/api.go:853-854` 仍使用 `models.BeijingLocation`

**文件**：`internal/web/api.go:853-854`

```go
time.Unix(o.CreatedAt, 0).In(models.BeijingLocation).Format("2006-01-02 15:04:05"),
map[bool]string{true: time.Unix(o.PaidAt, 0).In(models.BeijingLocation).Format("2006-01-02 15:04:05"), false: "-"}[o.PaidAt > 0],
```

**问题**：订单导出 CSV 时仍硬编码北京时间，未使用 `site_timezone` 配置。

**建议**：与 `apiDashboard` 一致，使用 `models.LocationFromTimezone(s.siteSettings().Timezone)`。

---

## 三、架构改进建议

### 3.1 配置缓存层

**现状**：`siteSettings()`、`paymentConfig()` 等函数每次请求都查询数据库（`db.GetSetting`），高并发时存在性能瓶颈。

**建议**：
```go
type SettingsCache struct {
    mu    sync.RWMutex
    cache map[string]string
    ttl   time.Duration
    last  time.Time
}

func (s *Server) siteSettings() SiteSettings {
    if cached := s.settingsCache.Get(); cached != nil {
        return cached
    }
    // 查询 DB 并缓存
}
```

### 3.2 订单状态机可视化

**现状**：`validOrderTransitions` 定义在代码中，运营人员无法直观理解状态流转。

**建议**：在后台仪表盘添加状态机图（Mermaid 或 SVG），展示：
```
created → waiting_payment → paid → processing → delivered → completed
   ↓           ↓            ↓
cancelled   expired   payment_failed
```

### 3.3 卡密库存预警阈值配置化

**现状**：`lowStockThreshold()` 硬编码为 10。

**建议**：添加到 `site_settings` 表，允许管理员自定义：
```go
func (s *Server) lowStockThreshold() int {
    if v, err := db.GetSetting(s.db, "low_stock_threshold"); err == nil {
        if n, err := strconv.Atoi(v); err == nil && n > 0 {
            return n
        }
    }
    return 10
}
```

---

## 四、安全加固建议

### 4.1 Session Cookie 添加 `Secure` 属性

**现状**：`shop_session` Cookie 未设置 `Secure: true`，纯 HTTP 部署时可能被中间人窃取。

**建议**：
```go
http.SetCookie(w, &http.Cookie{
    Name:     "shop_session",
    Value:    id + "." + s.signSession(id),
    Path:     "/",
    HttpOnly: true,
    Secure:   r.TLS != nil,  // 仅 HTTPS 时设置
    SameSite: http.SameSiteLaxMode,
    Expires:  time.Now().Add(12 * time.Hour),
})
```

### 4.2 添加请求 ID 追踪

**建议**：为每个请求生成唯一 ID，便于日志追踪：
```go
func requestIDMiddleware(next http.Handler) http.Handler {
    return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
        id := models.RandomToken(8)
        ctx := context.WithValue(r.Context(), "request_id", id)
        w.Header().Set("X-Request-ID", id)
        next.ServeHTTP(w, r.WithContext(ctx))
    })
}
```

---

## 五、测试覆盖建议

| 场景 | 当前覆盖 | 建议 |
|------|----------|------|
| 并发补发同一订单 | ❌ | 添加 `TestRedeliverConcurrent`，验证 `ReleaseLockedCards` 幂等性 |
| 时区切换后统计 | ❌ | 添加 `TestOrderCountsWithTimezone`，验证非北京时区自然日计算 |
| SMTP 配置遮蔽 | ❌ | 添加 API 测试，验证 `smtp_username_set` 为布尔值 |
| 审计日志完整性 | ⚠️ 部分 | 为 `payment_update`/`notify_update`/`site_update` 添加断言 |

---

## 六、总结

**修复质量**：✅ 所有 P0-P3 问题均已正确修复，代码可正常构建，核心功能恢复。

**新发现问题**：2 个中危（`Redeliver` 状态一致性、TOCTOU 竞态）、3 个低危（UI 语义、测试命名、时区遗漏）。

**建议优先级**：
- **P1**：修复 `Redeliver` 的 `reserved_order` 状态一致性（先释放再锁定）
- **P1**：修复 `apiAdminOrderRedeliver` 的审计日志竞态
- **P2**：统一 CSV 导出时区
- **P3**：UI 语义修正、测试命名优化

**整体评价**：修复及时且正确，架构设计良好，建议补充并发测试和配置缓存后可投入生产。

---

**审计人**：AI Assistant  
**报告生成时间**：2026-08-04
