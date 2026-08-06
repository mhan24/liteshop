# LiteShop 第三轮独立安全审查（完全从零）

**审查对象**：HEAD `73299b0`（2026-08-06，含前两轮修复、会话持久化、低危项清理、CSP 调整）
**审查方式**：不参考此前报告，重新走查当前全部代码与部署；对新增的会话持久化、订单链接邮件接口、CSP、站点源配置、前端图表依赖做重点复核。
**验证**：服务器 152.69.214.124 实况 + `go vet`/`go test` 全绿 + 会话持久化探针测试（重启后登录态保持、登出/删除后失效）+ 双前端 `npm audit` 与本地构建。

---

## 一、总体结论

前两轮的修复在代码中全部确认生效，未发现可被直接利用的支付/发卡/越权漏洞。新增的**会话持久化**经过探针测试验证正确（DB 存储、HMAC Cookie、滑动续期、删号/登出/恢复/重置即时吊销）。

本轮发现 **1 个 P2（订单查看链接接口可被用于向受害者邮箱轰炸）**，并在审计过程中顺手修复了 **1 个依赖漏洞（admin-ui echarts XSS）**。其余为低危观察项。

---

## 二、P2

### 🟠 P2-1：`POST /api/v1/orders/{orderNo}/link` 可被用于邮箱轰炸

`internal/web/api.go` `apiSendOrderLink`：只要提交的邮箱与订单 `buyer_contact` 一致，就向该邮箱发送一封带令牌的订单链接邮件。配合 `GET /api/v1/orders?contact=<邮箱>`（返回非已支付订单的 `order_no`），攻击者流程：

1. 得知受害者邮箱；
2. 通过邮箱查询拿到受害者的订单号（等待支付/新建/已取消订单都会返回 `order_no`）；
3. 循环调用 `/link` 接口 → 受害者邮箱收到大量订单链接邮件。

限流是**按 IP**（10 次/分），攻击者轮换 IP 即可绕过；且邮件由服务器 SMTP 发出，无法由受害者屏蔽。

**修复方向**：改为按"订单 + 邮箱"冷却（如每单每 5 分钟最多 1 封），或在已付款/已发卡订单上禁用该接口；同时邮箱查询可考虑不返回 `order_no`（改为"订单已找到，链接已发送到邮箱"的模糊响应）。

---

## 三、审计过程中已修复

### ✅ admin-ui 依赖 echarts <6.1.0（中危 XSS）

`npm audit` 发现 `echarts@5.6.0` 命中 [GHSA-fgmj-fm8m-jvvx](https://github.com/advisories/GHSA-fgmj-fm8m-jvvx)（XSS，CVSS 6.1），修复版本为 **echarts 6.1.0**（major 升级）。已升级至 `echarts@6.1.0`，`npm audit` 归零，admin-ui 构建通过（Dashboard 的 `init`/`setOption` 用法兼容 v6）。

---

## 四、P3 / 观察项

| # | 观察 | 说明 |
| --- | --- | --- |
| 1 | 存量旧订单（`view_token=''`）仍靠"邮箱 + 订单号"访问卡密 | 过渡设计：新订单已令牌化。无法安全回填（买家不知道新令牌），建议在文档中明确旧订单访问方式，长期不再存在 |
| 2 | `apiAdminOrdersBatchResend` 同步循环发送通知（最多 100 封） | operator 触发，可能长时间阻塞请求；建议改异步 |
| 3 | 会话滑动续期 = 每次请求一次 UPDATE | 单连接串行下小规模无碍，高并发时建议改为"过期前 N 分钟才续期" |
| 4 | Turnstile 验证未校验 `hostname`/`action` | 令牌单次有效，风险低；可在 siteverify 响应中补充校验 |
| 5 | `modernc.org/sqlite v1.34.4`（2024-07）版本偏旧 | 本地文件型数据库，远程利用面小；建议升级到新版本并回归迁移 |
| 6 | 线上 storefront systemd 单元未配置 `NUXT_PUBLIC_SITE_URL` | 当前靠 Caddy Host 回退，行为正确；建议按 install.sh 模板补上该变量（含 `SHOP_SETUP_TOKEN`） |
| 7 | 邮箱查询的 Turnstile 令牌经 GET query 传递 | 会进服务器访问日志（当前未开日志）；可改 POST body |
| 8 | `/docs` 匿名 303、登录后可用 | 已按预期工作 |
| 9 | Cloudflare 托管 robots.txt（"content signals" 前缀） | 第三方 CDN 特性，非本站代码；本站 robots 内容正确 |

---

## 五、重点复核结论（新增代码）

- **会话持久化**（迁移 010 + `sessions` 表）：Cookie 仍为 HMAC 签名随机 ID；DB 为唯一事实来源；过期/滑动续期/删号吊销/登出/恢复/重置清理全部正确；探针测试通过（含"重启后仍有效"）。✅
- **订单查看链接接口**：令牌只发往登记邮箱、403 拒绝邮箱不匹配、限流已加（P2-1 除外）。✅
- **CSP**：`script-src 'self' 'unsafe-eval'`（vue-i18n 运行时编译所需），无远程脚本源；Cloudflare 统计脚本被 AdGuard 扩展 CSP 拦截属浏览器扩展行为，与本站无关。✅
- **站点源**：sitemap/robots/canonical/og 统一走 `NUXT_PUBLIC_SITE_URL`，不再信任 Host；线上 sitemap 输出正确。✅
- **依赖**：storefront 0 漏洞；admin-ui 升级 echarts 后 0 漏洞。✅
- **服务器**：数据目录 700、DB 600、systemd UMask、HSTS、旧备份已归档 root-only；三服务 active。✅

---

**审查人**：AI Assistant
**审查时间**：2026-08-06
