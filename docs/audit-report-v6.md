# LiteShop 完整代码审计报告（第六轮）

**审计范围**：当前 HEAD（v1.1–v1.4 功能及后续修复）  
**审计时间**：2026-08-05  
**审计方式**：静态代码审查、数据流审查、迁移/API/权限复核

> 本轮重点复核：优惠券资损、TOTP、回调路径、Webhook、库存/阶梯价、报表、管理员 API 和迁移。当前环境没有 Go 编译器，未执行 `go test`/`go vet`；结论基于源码审查。

---

## 一、结论摘要

前一轮的主要问题大部分已修复：

- 优惠券支付失败回滚：已实现
- 优惠券并发用量原子递增：已实现
- TOTP 已启用后不再返回 secret：已修复
- 2FA 临时 token 清理：已实现
- 0 元订单：已拒绝
- 回调路径格式校验：已实现

但当前仍发现 **2 个高优先级数据一致性问题、2 个中优先级安全/运维问题、若干低优先级问题**。

| 级别 | 数量 | 状态 |
|---|---:|---|
| 🔴 P0 | 1 | 优惠券使用失败被忽略，可能按无效券给出折扣 |
| 🟠 P1 | 2 | 阶梯价顺序导致价格错误；毛利统计使用当前成本而非下单时成本 |
| 🟡 P2 | 3 | Webhook secret 后台仍不可配置；限流表仍不清理；TOTP secret 存储未加密 |
| 🟢 P3 | 3 | 输入校验、幂等/审计、构建验证与测试覆盖改进 |

**当前结论：不建议在修复 P0/P1 前宣称“完全生产就绪”。**

---

## 二、P0：优惠券 `UseCoupon` 错误被忽略

**位置**：`internal/order/service.go:101`

```go
if discount > 0 {
    _ = s.repo.UseCoupon(couponID, order.OrderNo, discount)
    _ = s.repo.AddLog(...)
}
```

### 风险

`UseCoupon` 已经正确实现了原子额度检查：

```sql
UPDATE coupons
SET used_count = used_count + 1
WHERE id = ? AND (max_uses = 0 OR used_count < max_uses)
```

但 service 完全忽略其返回错误。于是可能出现：

1. `ApplyCoupon` 读取券时仍显示可用；
2. 订单创建成功；
3. `UseCoupon` 因并发用尽、数据库异常等原因返回错误；
4. 订单金额已经按折扣价计算，但优惠券并未记录使用；
5. 订单可继续支付，形成实际资损。

这是上一轮修复原子竞态后留下的错误处理缺口，严重程度高于单纯竞态。

### 修复建议

```go
if discount > 0 {
    if err := s.repo.UseCoupon(couponID, order.OrderNo, discount); err != nil {
        _ = s.repo.ReleaseLockedCards(order.ID)
        _ = s.repo.SetOrderStatus(order.ID, models.OrderPaymentFailed)
        return order.OrderNo, "", 0, 0, err
    }
    _ = s.repo.AddLog(...)
}
```

更好的方案是把“锁定库存 + 占用优惠券 + 创建订单”设计成一个业务事务，至少必须保证：优惠券占用失败时订单不能继续创建支付交易。

同时应增加测试：

- `max_uses=1` 并发两次下单，最终只有一笔获得折扣；
- 模拟 `UseCoupon` 失败，确认订单不以折扣金额进入支付。

---

## 三、P1：阶梯价依赖输入顺序，可能套用错误折扣

**位置**：`internal/order/service.go:58-63`

```go
for _, tier := range p.Wholesale {
    if qty >= tier.MinQty {
        amountCents = baseCents * int64(qty) * int64(tier.Discount) / 100
    }
}
```

### 问题

代码使用“最后一个匹配档位”作为最终价格，但没有：

- 按 `MinQty` 排序；
- 检查 `Discount` 范围；
- 检查档位是否重复；
- 检查折扣是否单调合理。

例如档位输入为：

```json
[
  {"min_qty": 10, "discount": 80},
  {"min_qty": 2, "discount": 90}
]
```

购买 10 件时最终可能套用 9 折，而不是 8 折。后台用户可以通过 API 直接提交任意顺序，因此不能只依赖前端排序。

### 修复建议

在 service 内选择 `min_qty` 最大且不超过 `qty` 的档位，并验证：

- `min_qty >= 1`；
- `1 <= discount <= 100`；
- 档位 `min_qty` 不重复；
- 可选：折扣随数量增加不能变差。

不要依赖 JSON 数组的顺序。

---

## 四、P1：毛利统计使用当前商品成本，历史利润会漂移

**位置**：`internal/web/api.go` 仪表盘毛利查询

```sql
SELECT COALESCE(SUM(p.cost_cents * o.qty), 0)
FROM orders o JOIN products p ON p.id = o.product_id
WHERE ...
```

### 问题

订单支付后如果管理员修改商品 `cost_cents`，历史订单的毛利会随当前商品成本变化。这样：

- 昨日利润会被今天的成本修改影响；
- 财务报表不可审计；
- 商品删除/迁移时统计可能异常；
- 订单详情没有历史成本快照。

### 修复建议

在 `orders` 表增加：

```sql
cost_cents INTEGER NOT NULL DEFAULT 0
```

创建订单时从商品复制成本，之后毛利使用 `orders.cost_cents * orders.qty`。如果还要精确支持阶梯价/优惠券，应同时保存：

- 原始金额；
- 优惠金额；
- 最终金额；
- 成本快照；
- 使用的优惠券 ID。

---

## 五、P2：Webhook secret 仍没有后台保存入口

当前代码已能返回：

```json
{"webhook_secret_set": true}
```

并且发送 Webhook 时会读取 `webhook_secret`，但 `apiAdminNotifySave` 中只保存：

- `webhook_url`
- SMTP 配置
- Telegram 配置
- 通知模板

未发现 `webhook_secret` 的保存逻辑，前端也没有对应输入项。因此 HMAC 签名功能仍需要人工写数据库才能启用，属于功能闭环缺失。

### 建议

- 后台增加 secret 输入框；
- GET 只返回 `webhook_secret_set`，不要返回明文；
- POST 仅在非空时更新，允许用户保留旧 secret；
- 保存动作写入审计日志；
- 增加 HMAC header 的集成测试。

---

## 六、P2：RateLimiter 的 `Cleanup()` 仍未调用

`internal/web/ratelimit.go` 定义了：

```go
func (rl *RateLimiter) Cleanup()
```

但当前代码中未发现任何调用点。每个受限路由创建独立的 `RateLimiter`，其 `visitors` map 会持续保留访问过的 IP。

影响：

- 低频访问时是小型内存泄漏；
- 长时间运行、攻击者大量变更 IP 时会持续增长；
- 登录和下单各自维护一份 map。

### 建议

将 limiter 作为 Server 字段，在初始化时统一创建，并由一个 ticker 定期清理；或者在 `rateLimitMiddleware` 内启动生命周期明确的清理任务。更推荐把 `RateLimiter` 设计为可关闭对象，避免每个 handler 启动不可回收 goroutine。

同时建议给 map 设置容量保护或采用时间轮/LRU。

---

## 七、P2：TOTP secret 仍为明文存储

当前已修复“已启用后明文返回”的 API 泄露问题，但 `admins.totp_secret` 仍直接存储 Base32 secret。

### 风险

数据库备份、管理员误导出、文件读取权限泄露时，攻击者可直接生成 TOTP 验证码。TOTP secret 不像密码一样可单向哈希，因为验证需要原值，但应加密存储。

### 建议

- 使用由 `session_secret` 或独立 `totp_encryption_key` 派生的 AES-GCM 密钥；
- 数据库只保存密文 nonce+ciphertext；
- 迁移时兼容旧明文并在下次绑定/登录时升级；
- 备份/恢复文档明确说明密钥依赖；
- 不要使用站点普通配置直接作为加密密钥。

若项目明确定位为低风险单管理员工具，可标为 P2，但生产部署仍建议处理。

---

## 八、P3 及工程性问题

### 8.1 优惠券输入校验不完整

`couponFromJSON` 将非法类型默认改成 `fixed`，但没有拒绝：

- 负数 `value_cents`；
- 负数 `percent`；
- `percent > 100`；
- 负数 `min_amount_cents`；
- 负数 `max_uses`；
- 过去的 `expires_at`；
- 非法 `product_id`。

建议在 API 层拒绝非法输入，而不是静默纠正。静默纠正会造成运营人员以为创建了百分比券，实际却创建成固定券。

### 8.2 批量重发缺少数量上限

`apiAdminOrdersBatchResend` 接受任意长度 `IDs`，逐个同步发送邮件/Telegram。应设置最大数量（如 100），并改为异步任务，否则后台请求可能超时，重复提交会造成邮件轰炸。

### 8.3 迁移/配置与测试验证

本机没有 Go 工具链，无法运行：

```bash
go test ./...
go vet ./...
go test -race ./...
```

发布前必须在 CI 或构建机执行，并补充：

- 优惠券并发使用测试；
- 支付失败回滚测试；
- 阶梯价乱序测试；
- 毛利成本快照测试；
- Webhook HMAC 验签测试；
- 2FA 登录完整流程测试。

---

## 九、优点确认

本轮确认以下实现方向正确：

- PBKDF2 密码哈希 + HMAC session；
- TOTP 使用 `crypto/rand`、HMAC-SHA1、±1 步钟差容忍，算法实现符合 RFC 6238 常见实现；
- TOTP 临时 token 现在有定时清理；
- 回调路径使用正则限制字符，非法配置回退默认值；
- CSV 公式注入防护已覆盖用户可控字段；
- Webhook HMAC 使用请求原始 JSON 计算签名，方式正确；
- 优惠券额度递增已改为原子 SQL；
- 支付失败、取消、过期已有优惠券回滚路径；
- 订单和库存核心操作仍保持参数化 SQL 与事务边界。

---

## 十、修复优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| P0 | `UseCoupon` 错误被忽略 | 失败即回滚订单/库存，不得继续支付 |
| P1 | 阶梯价依赖数组顺序 | 选择最大匹配档位并严格校验 |
| P1 | 毛利无历史成本快照 | 订单保存 `cost_cents` 快照 |
| P2 | Webhook secret 无配置入口 | 补 API/UI/审计/测试 |
| P2 | RateLimiter Cleanup 未调用 | 统一 limiter + 定时清理 |
| P2 | TOTP secret 明文存储 | AES-GCM 加密存储 |
| P3 | 优惠券输入校验 | 拒绝非法值，禁止静默纠正 |
| P3 | 批量重发无上限 | 限制数量并异步化 |

---

## 十一、最终结论

本轮新增功能整体已接近可上线质量，前一轮提出的主要安全问题大多已修复。但仍有一个明确的 P0 资损风险：**优惠券占用失败时仍可能按折扣金额创建订单**。此外，阶梯价乱序和历史毛利漂移会造成财务数据错误。

修复 P0 + 两个 P1，并通过 CI 的 `go test ./...`、`go vet ./...` 后，再评估为生产就绪。

**审计人**：AI Assistant  
**报告生成时间**：2026-08-05  
**审计轮次**：6
