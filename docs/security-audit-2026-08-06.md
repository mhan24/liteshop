# LiteShop 安全审计（全新一轮 · 从零复核）

**审查对象**：当前 HEAD（`e701079`）全量代码与生产部署（152.69.214.124 / shop.3737.de）
**审查方式**：不参考任何历史报告；外部攻击者、内部越权、运维实况三视角重新走查。
**验证**：全量代码阅读 + 服务器实况 + `go vet`/`go test` + 双前端 `npm audit` + 在线探测。

---

## 一、总体结论

支付、发卡、会话、令牌、状态机、RBAC、限流、供应链与部署加固均通过复核，无可直接利用的漏洞。本轮发现 **1 个 P2（优惠券错误包装过宽，可能向买家回显数据库错误细节）**，其余为低危观察项。

---

## 二、P2

### 🟠 P2-1：优惠券业务错误包装过宽，数据库错误可能回显给买家

`internal/order/service.go` `CreateOrder`：

```go
couponID, cidErr = s.repo.GetCouponIDByCode(couponCode)
if cidErr != nil {
	return "", "", 0, 0, newBusinessErrorf("%s", cidErr.Error())
}
d, err := s.repo.ApplyCoupon(couponCode, amountCents, p.ID)
if err != nil {
	return "", "", 0, 0, newBusinessErrorf("%s", err.Error())
}
```

`GetCouponIDByCode` / `GetCouponByCode` 对**非"未找到"的数据库错误**（连接失败、约束冲突等）原样返回；`UseCoupon` 的事务错误同理。这些错误被无差别包装成 `BusinessError` 后，会经 502 响应回显给买家——SQL/底层细节可能外泄。

**修复方向**：只包装已知业务错误（`ErrCouponNotFound`/`ErrCouponExpired`/`ErrCouponUsedUp`/`ErrCouponNotApplicable`），其余错误透传为系统错误（统一脱敏）。

---

## 三、P3 / 观察项

| # | 观察 | 说明 |
| --- | --- | --- |
| 1 | 订单详情轮询接口无限流 | `GET /api/v1/orders/{orderNo}` 被订单页每 3 秒轮询，无认证无限流；可被放大请求（低危 DoS）。建议加每 IP 限流 |
| 2 | 存量旧订单仍可用"邮箱+订单号"访问卡密 | 过渡兼容（新订单已令牌化），已文档化 |
| 3 | `low_stock_notified_<id>` 等 settings 键随商品数增长 | 轻微；可迁移独立表 |
| 4 | 本地开发需 Go ≥1.25 | 文档/CI/Docker 已同步 |
| 5 | `audit_logs` 清理每 5 分钟全表扫描一次 | 表无 `created_at` 索引，规模小无碍；量大时可加索引 |
| 6 | 下单失败返回 502 且携带 `order_no` | 设计如此（供重试），无安全影响 |

---

## 四、重点复核结论（全部通过）

- **会话**：DB 持久化 + HMAC Cookie + `__Host-`/普通名切换 + 滑动续期 + 登出/删号/恢复/重置即时吊销；写库失败返回 500。✅
- **订单访问**：邮箱查询模糊响应；查看链接只发登记邮箱；`/orders/links` 单封邮件 + 按邮箱冷却 + **Turnstile（线上实测无令牌返回 403）**；新订单令牌恒定时间比对。✅
- **支付链路**：回调 MD5 验签、单事务幂等发卡、重复回调不重复发卡、通知异步且买家邮件收敛为一封。✅
- **状态机**：手动改状态校验枚举与合法迁移；取消/过期原子化；补发仅限已支付类状态；过期接口非法状态返回 400。✅
- **认证**：PBKDF2-SHA256 10 万次 + 恒定时间；登录时序均摊；TOTP AES-GCM + 一次性令牌；下单/查询/解锁/发链接均限流。✅
- **错误处理**：下单网关/DB 错误统一脱敏；券码/库存/数量等业务错误回显（P2-1 为包装过宽的边界情况）。✅
- **注入/XSS**：SQL 全参数化；markdown `html:false`；Vue/Nuxt 转义；后台 CSP；CSV 注入防护；图片 URL 限 http/https。✅
- **供应链/运维**：Go 1.26.5 + modernc v1.56.0（全测试绿）；双前端 0 依赖漏洞；无外部 CDN 运行时依赖；数据目录 700 / DB 600 / 备份 root-only；UMask=0077；HSTS；`NUXT_PUBLIC_SITE_URL` 与 `SHOP_SETUP_TOKEN` 已配置；三服务 active；`/health`/后台/公网 200；`/docs` 匿名 303。✅

---

**审查人**：AI Assistant
**审查时间**：2026-08-06
