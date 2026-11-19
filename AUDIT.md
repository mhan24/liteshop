# liteshop 审计报告

## 2026-11-19 · 第 1 轮

范围：全部服务端代码（下单 / 回调 / 发卡 / 清扫 / 买家与后台操作）、鉴权与入口伪装、
配置与环境校验、CI、Docker Compose、依赖。基线 66 用例全绿；修复后 80 用例全绿，
`tsc --noEmit`、`eslint`、`next build`、`npm audit --omit=dev`（0 漏洞）均通过。

### 已修复

| # | 级别 | 问题 | 修复 | 回归测试 |
|---|---|---|---|---|
| 1 | 严重 | `next@16.4.0` 命中 GHSA-2464-fhr4-w9xw（图片优化未授权 RCE）等 5 条公告 | 升级 `next` / `eslint-config-next` 到 16.4.6（同 minor 补丁版） | `npm audit` |
| 2 | 严重 | 补货后「重试发卡」永远失败：发卡只卖本单 `reserved` 的卡，新导入的卡是 `available`；且卡不足时已把部分卡标 `sold` 并提交，却不写交付记录 → 丢卡 | `sellOrderCards`：按商品补锁缺口，任一不足则一张不卖（全有或全无），齐备后一次性交付 | `delivery-recovery`：删锁定卡 → paid → 补货 → 重试完成 |
| 3 | 高 | 取消订单 / 重新支付只要「订单号 + 邮箱」，订单号会出现在收银台回跳地址里，可被他人取消订单或作废支付 | 与查单同为三因子（+ 查单密码），前台表单同步增加字段 | `order-lifecycle`、`delivery-recovery` |
| 4 | 高 | `ADMIN_PATH` 伪装失效：proxy matcher 只写了 /admin、/manage、/console，自定义入口直接 404；改写时还丢掉了 `/admin` 前缀 | 路由判定抽成纯函数 `lib/admin-path`，matcher 覆盖全部页面路由；env 层规范化并禁止占用 /api、/_next | `admin-path.test` |
| 5 | 高 | 生产环境可启用 `PAYMENT_DRIVER=mock`，mock 收银台对任何人开放「确认支付」= 免费发卡（CI 注释提到的 `assertProductionSafety()` 已不存在） | env 校验：`NODE_ENV=production` 时拒绝 mock，启动即失败 | `env.test` |
| 6 | 高 | 订单建好之后，支付尝试阶段的异常（适配器抛错、回填失败）会让订单停在「pending + 无有效期」：清扫永远扫不到，卡密永久占用；之后真到账的回调还会被判「交易不属于当前订单」 | 落 pending 支付记录后的任何异常都按 unknown 处理 → reconciling；unknown 时支付记录保持 pending；pending 订单的回调也可认领缺 providerRef 的当前尝试 | 适配器抛错 → reconciling；响应丢失 → 回调认领发卡 |
| 7 | 中 | 并发「重新支付」：无订单行锁，可产生多条当前尝试；回填按「当前尝试」更新会写错行；回填事务锁顺序（payments→orders）与建尝试相反，触发 40P01 死锁 | 建尝试在订单行锁内复核状态；回填按 payment id，锁顺序统一为 orders→payments | 4 路并发重新支付只留 1 条当前尝试 |
| 8 | 中 | 重新支付作废旧尝试时不通知网关撤销旧交易 | 作废后 best-effort 调用网关撤销；买家仍向旧交易付款则记 late | 旧交易到账 → late |
| 9 | 中 | 后台可删除 reserved / sold 卡密，可删除仍有卡被未完成订单锁定的商品（级联删卡） | 只允许删 available 卡；商品有锁定卡时拒绝删除 | — |
| 10 | 中 | cron 密钥经 query 传递（进访问日志）且非常量时间比较 | 只接受 `Authorization: Bearer`，sha256 + `timingSafeEqual`；compose 同步改为发头 | `cron.test` |
| 11 | 低 | 查单：订单号 + 邮箱不匹配时不做 Argon2 校验，可按耗时枚举 | 不匹配时对惰性生成的 dummy 哈希做同等开销校验（查单 / 取消 / 重新支付共用） | — |
| 12 | 低 | 「重新支付」成功时返回 `paymentUrl` 在顶层，前台读 `data.paymentUrl`，新收银台链接从不显示 | 返回结构统一为 `data.paymentUrl` | `delivery-recovery` |
| 13 | 低 | 同一 slug 在购物车出现多行 → 分两次锁卡、交付内容重复段落 | 下单时按 slug 合并 | `delivery-recovery` |
| 14 | 低 | 编辑商品 slug 冲突直接抛 500；导入卡密报告的数量含被跳过的重复行、商品不存在时报「导入失败」 | 捕获并给出明确提示；按实际插入行数报告 | — |
| 15 | 低 | CI 已过期：仍 `npm rebuild better-sqlite3`、测试无 PostgreSQL 服务、检查不存在的 `scripts/ops/` | 重写：postgres:18 service、去掉 SQLite 残留与失效路径 | — |

### 清理的兼容层 / 死代码

- `scripts/db/migrate.ts`（与容器用的 `migrate.mjs` 重复）→ `npm run db:migrate` 统一走 `migrate.mjs`（`--env-file-if-exists=.env`）
- 四处重复的「关单 + 作废支付 + 释放卡密」→ `closePendingInTx`；三处重复的网关撤销 → `cancelAtGateway`
- 删除未使用：`LITEPAY_WEBHOOK_PATH`、`fiatAmountForGateway`、`normalizeOrigin`、`siteUrl()`、
  `listRecentOrders`、`Database` 类型、`rejectedNotifyStats`（无界增长的内存计数，改为日志）、
  `bumpAdminSessionVersion`（与 `revokeAllSessions` 重复，改密时被调用两次）、
  `payments.anomaly` 的 `duplicate` 枚举值（从未写入；text 枚举无 DB 约束，无需迁移）
- `orders.ts` 本地 `Tx` 类型改用 `server/db-tx`；`audit()` 去掉多余的动态 import

### 未修复（记录待决）

第 1 轮遗留项已在第 2 轮处理，见下文。

### 部署注意

本轮改动**未部署**。上线时 `docker-compose.yml` 会随 `scripts/deploy.sh` 一并上传（cron 改用 Bearer 头，
新旧版本必须同时更新，脚本已保证）。无数据库迁移。

## 2026-11-19 · 第 2 轮（处理第 1 轮遗留）

修复后 86 用例全绿；`tsc`、`eslint`、`next build` 通过，并以生产模式实际启动验证了响应头与后台入口伪装。

| # | 级别 | 问题 | 修复 | 回归测试 |
|---|---|---|---|---|
| 1 | 中 | SMTP 密码、Turnstile Secret 明文存 settings 表 | 与 LitePay 令牌同用 AES-256-GCM 加密存储；容器启动迁移（`scripts/db/encrypt-secrets.mjs`）把存量明文一次性加密，幂等。读取只认密文，不保留明文/密文双读兼容层 | `secret-settings`：迁移互通、幂等、未迁移明文不被使用 |
| 2 | 中 | Caddyfile 写死域名，`DOMAIN` 变量不生效 | Caddyfile 改读 `{$DOMAIN}` / `{$PAY_DOMAIN}`；compose 中两者必填（缺失时创建容器前报错）；`deploy.sh` 部署前校验服务器 `.env` 的 `DOMAIN` 与 `SITE_URL` 一致，否则在构建前中止；CI 用官方 caddy 镜像解析 Caddyfile | CI `Caddyfile check` |
| 3 | 低 | 无 CSP / HSTS | 全站 CSP（放行 Turnstile；生产不含 `unsafe-eval`；禁止嵌入与外部表单提交）；Caddy 增加 HSTS（1 年，不含子域/preload，避免误伤） | `security-headers.test` |
| 4 | 低 | 商品页 JSON-LD 直接 `JSON.stringify` 嵌入 `<script>`，商品名含 `</script>` 可截断注入 | `jsonForScriptTag` 转义 `<` | `security-headers.test` |
| 5 | 低 | 商品图片地址不校验协议（渲染为 `<img src>` / og:image） | 只接受 http/https | — |

### 仍待确认

- **生产 `.env` 必须有 `DOMAIN` 和 `PAY_DOMAIN`。** 本轮不能读取生产配置（权限限制），无法确认现值。
  缺失或不一致时 `deploy.sh` 会在构建前中止，不会影响线上服务；按提示补上即可。
- `pay` 站点依赖手工把 litepay 容器接入 caddy 所在网络，属运维约定，未改。
- 限流仍为进程内内存（单实例前提）。
- Caddyfile 本机未能用 caddy 实测（下载外部程序被权限拦截），由 CI 校验。
