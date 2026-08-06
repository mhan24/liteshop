# LiteShop 安全审计（全新一轮 · 从零复核）

**审查对象**：当前 HEAD（`4f2c4ad`）全量代码与生产部署（152.69.214.124 / shop.3737.de）
**审查方式**：不参考任何历史报告；外部攻击者、内部越权、运维实况三视角重新走查。
**验证**：全量代码阅读 + 服务器实况 + `go vet`/`go test` + 双前端 `npm audit` + 在线探测。

---

## 一、总体结论

支付、发卡、会话、令牌、状态机、RBAC、限流、供应链与部署加固均通过复核，无可直接利用的漏洞。本轮新发现 **1 个 P2（Go HTTP 服务无超时配置）** 与若干低危观察项；上轮修复（优惠券错误收窄、订单详情/取消限流、日志索引）已在代码与线上确认生效。

---

## 二、P2

### 🟠 P2-1：Go HTTP 服务未配置任何超时

`cmd/shop/main.go`：

```go
log.Fatal(http.ListenAndServe(cfg.ListenAddr, handler))
```

`http.Server` 的 `ReadHeaderTimeout`/`ReadTimeout`/`WriteTimeout`/`IdleTimeout` 全部为零：慢速请求（slowloris、慢速 body）可长期占用连接与 goroutine。当前部署位于 Cloudflare + Caddy 之后，Caddy 自带超时提供了一定缓解，但 Go 服务本身没有纵深防御，本地/直连部署时风险更高。

**修复方向**：改用显式 `http.Server` 并设置 `ReadHeaderTimeout: 10s`、`ReadTimeout: 30s`、`WriteTimeout: 60s`、`IdleTimeout: 120s`（需避免与后台导出等慢响应冲突，可适当放宽 WriteTimeout）。

---

## 三、P3 / 观察项

| # | 观察 | 说明 |
| --- | --- | --- |
| 1 | `POST /api/v1/setup` 无限流 | 仅预初始化阶段可用；`SHOP_SETUP_TOKEN` 为 24 位随机串，爆破不可行，但可加 10 次/分限流做纵深 |
| 2 | SMTP 发送无显式拨号超时 | 依赖操作系统 TCP 超时，慢 SMTP 会挂住发送 goroutine；建议 `smtp.DialTimeout` |
| 3 | 存量旧订单仍可用"邮箱+订单号"访问卡密 | 过渡兼容（新订单已令牌化），已文档化 |
| 4 | `low_stock_notified_<id>` 等 settings 键随商品数增长 | 轻微；可迁移独立表 |
| 5 | 本地开发需 Go ≥1.25 | 文档/CI/Docker 已同步 |
| 6 | 下单失败返回 502 且携带 `order_no` | 设计如此（供重试） |

---

## 四、重点复核结论（全部通过）

- **会话**：DB 持久化 + HMAC Cookie + `__Host-`/普通名切换 + 滑动续期 + 登出/删号/恢复/重置即时吊销；写库失败返回 500。✅
- **订单访问**：邮箱查询模糊响应；查看链接只发登记邮箱；`/orders/links` 单封邮件 + 按邮箱冷却 + Turnstile；新订单令牌恒定时间比对；详情/取消已限流。✅
- **支付链路**：回调 MD5 验签、单事务幂等发卡、重复回调不重复发卡、通知异步且买家邮件收敛为一封。✅
- **状态机**：手动改状态校验枚举与合法迁移；取消/过期原子化；补发仅限已支付类状态；过期接口非法状态返回 400。✅
- **认证**：PBKDF2-SHA256 10 万次 + 恒定时间；登录时序均摊；TOTP AES-GCM + 一次性令牌；下单/查询/解锁/发链接均限流。✅
- **错误处理**：业务错误（券码/库存/数量）回显，网关/DB 错误统一脱敏；优惠券仅已知 `ErrCoupon*` 业务错误回显（上轮修复已确认）。✅
- **注入/XSS**：SQL 全参数化；markdown `html:false`；Vue/Nuxt 转义；后台 CSP；CSV 注入防护；图片 URL 限 http/https；site_links 限 50。✅
- **供应链/运维**：Go 1.26.5 + modernc v1.56.0（全测试绿）；双前端 0 依赖漏洞；无外部 CDN 运行时依赖；迁移 011（日志索引）已应用；数据目录 700 / DB 600 / 备份 root-only；UMask=0077；HSTS；`NUXT_PUBLIC_SITE_URL` 与 `SHOP_SETUP_TOKEN` 已配置；三服务 active；`/health`/后台/公网 200；`/docs` 匿名 303。✅

---

**审查人**：AI Assistant
**审查时间**：2026-08-06
