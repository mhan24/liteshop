# LiteShop 安全审计（全新一轮 · 从零复核）

**审查对象**：当前 HEAD（`d5f5374`）全量代码与生产部署（152.69.214.124，shop.3737.de）
**审查方式**：不参考任何历史报告，从"外部攻击者 + 内部越权 + 运维实况"三个视角重新走查全部 Go 后端、SQL 迁移、前台 Nuxt SSR、后台 Vue SPA、部署配置与依赖。
**验证手段**：全量代码阅读 + 服务器实况检查 + `go vet`/`go test` + 会话持久化探针测试 + 双前端 `npm audit` 与构建。

---

## 一、总体结论

未发现可直接利用的支付/发卡/越权/注入漏洞。订单令牌、会话持久化、状态机、RBAC、限流、依赖供应链、部署加固均处于良好状态。本轮发现 **1 个 P2（下单失败时向客户端回显网关错误细节）**，其余为低危观察项。

---

## 二、P2

### 🟠 P2-1：下单失败接口回显内部错误细节

`internal/web/api.go` `apiCreateOrder` 的失败分支：

```go
if orderNo != "" {
	writeJSON(w, 502, map[string]any{"error": err.Error(), "order_no": orderNo})
} else {
	writeError(w, 502, err.Error())
}
```

`err.Error()` 可能包含：
- BEpusdt 网关返回的原始响应体（`internal/bepusdt/client.go` 的错误信息带 `body=%s`，可能含网关地址/内部字段）；
- 数据库/业务细节（库存、券码校验等，部分信息可接受但不宜全量外泄）。

**修复方向**：区分"业务错误"（如库存不足、券不可用，可回显给用户）与"系统错误"（网关/DB 异常，只写日志并返回通用文案 + 订单号）。

---

## 三、P3 / 观察项

| # | 观察 | 说明 |
| --- | --- | --- |
| 1 | 支付成功可能向买家发多封邮件 | `SendPaid`（付费模板）+ `Notify(EventPaymentSuccess)` + `Notify(EventDelivered)` 均可能发邮件，一笔订单最多 3 封。建议收敛为单一邮件 |
| 2 | `apiAdminOrderExpire` 对已支付订单静默 200 | `Expire` 已对非法状态返回错误，但该 handler 忽略错误且仍返回 ok/写审计，与 cancel 的 400 行为不一致 |
| 3 | 邮箱查询仍返回非已支付订单的 `order_no` | 配合 `/link` 按邮箱冷却已遏制轰炸；若需进一步收敛可改为"链接已发送到邮箱"的模糊响应 |
| 4 | `startSession` 数据库写入失败仍下发 Cookie | 登录看似成功、下次请求即失效；建议写库失败时返回 500 |
| 5 | 备份 JSON 仍含全部密钥（除 session_secret） | admin 权限可下载；建议文档提示妥善保管或提供加密备份 |
| 6 | `site_links` 无数量上限；logo/favicon/默认图 URL 未校验 | 前端渲染为 `<img>`，无脚本执行面；建议加数量与协议白名单 |
| 7 | `/setup` 保护未启用 | 服务器 `SHOP_SETUP_TOKEN` 为空；当前站点已初始化（HasAdmin 拦截），仅对全新部署有抢占风险 |
| 8 | 服务器 Go 1.22 较旧，modernc 因此锁定 v1.36.0 | 如需最新 SQLite 驱动需先升级 Go 工具链 |
| 9 | `clientIP` 信任 `CF-Connecting-IP` | 当前拓扑确实位于 Cloudflare 之后（已验证），限流信任模型成立；若将来直连暴露需收紧 |
| 10 | Turnstile hostname 校验 | 若用户以 IP/备用域名访问页面而 API 走主域名，下单会被拒；当前线上一致，无影响 |
| 11 | `apiSetup`/`apiAdminCreateAdmin` 用户名无长度上限 | 建议限制长度（如 ≤64） |
| 12 | `sessionSecret` 惰性生成 | 若用缺失该键的旧备份整体恢复（非本系统 restore），会话与 TOTP 解密会失效 |

---

## 四、重点复核结论（全部通过）

- **会话**：DB 持久化（迁移 010）、HMAC 签名 Cookie、`__Host-`/普通名按 HTTPS 切换、滑动续期（剩余 <1h 才刷新）、登出/删号/恢复/重置即时吊销；探针测试覆盖"重启后仍有效、删除后失效"。✅
- **订单访问**：新订单查看令牌只经邮件下发；邮箱查询不下发令牌 URL；`/link` 按邮箱 5 分钟冷却；旧订单邮箱回退有文档说明。✅
- **支付链路**：回调 MD5 验签、`MarkPaidAndDeliver` 单事务（确认+发卡）幂等、重复回调不重复发卡、通知异步化不阻塞应答。✅
- **状态机**：手动改状态校验枚举与合法迁移；cancelled/expired 走原子取消/过期（释放卡密+回滚券）；补发仅限已支付类状态。✅
- **认证**：PBKDF2-SHA256 10 万次 + 恒定时间；登录对不存在用户等量计算防枚举；TOTP AES-GCM 加密、一次性 2FA 令牌；登录/验证/下单/查询/解锁/链接均有限流。✅
- **注入/XSS**：SQL 全参数化；markdown `html:false`；Vue/Nuxt 默认转义；后台 CSP 已含 `unsafe-eval`（vue-i18n 所需）；CSV 公式注入防护。✅
- **供应链/依赖**：storefront 与 admin-ui `npm audit` 均为 0 漏洞；echarts 6.1.0 本地打包；Swagger 无外链；默认图站内；go 依赖升级到兼容版本后 `go vet`/`go test` 全绿。✅
- **运维**：数据目录 700、DB 600、systemd UMask=0077、HSTS 生效、备份归档 root-only、`NUXT_PUBLIC_SITE_URL` 已配置、三服务 active、`/health`/后台/公网均 200。✅

---

**审查人**：AI Assistant
**审查时间**：2026-08-06
