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

- ~~生产 `.env` 的 DOMAIN / PAY_DOMAIN~~：部署时已核实 `DOMAIN=shop.9527.tr`；`PAY_DOMAIN` 未设置，改为可选（默认 pay.9527.tr）。
- ~~pay 站点依赖手工 network connect~~：部署时发现 caddy 被手工接入 `liteshop_default`（litepay 所在网络），
  重建 caddy 会丢失该连接导致 pay 站点 502。已在 compose 中声明为 external 网络，重建后自动接入。
- 限流仍为进程内内存（单实例前提）。
- Caddyfile 本机未能用 caddy 实测（下载外部程序被权限拦截），由 CI 校验。

## 2026-11-19 · UI 重构中顺带发现的问题

| # | 级别 | 问题 | 修复 | 回归测试 |
|---|---|---|---|---|
| 1 | 中 | 未设置的数字型配置读成 0（`Number(null) === 0`），默认值永不生效：补货阈值默认 0 = 从不提醒；会话版本默认 0 而非 1 | 空值回落默认值 | `settings-number.test` |
| 2 | 中 | 下单成功后购物车不清空，订单完成后顶栏仍显示件数，易诱导重复下单 | 建单成功即清空 | 浏览器流程验证 |
| 3 | 低 | 商品列表依赖 JS 才显示（入场动画初始透明），弱网下首屏空白 | 改为渐进增强：默认可见，只给视口下方元素加动画 | 浏览器验证 |
| 4 | 低 | 后台删除、关单、人工确认到账等不可撤销操作无二次确认，且与主操作同样式 | `variant="danger"` + `confirmText` | — |
| 5 | 低 | 复制卡密无反馈；缺 favicon（404） | `CopyButton` 显示结果；新增 `icon.svg` | — |

部署注意：修复 #1 后，若生产库从未设置过会话版本，管理员需要重新登录一次（旧会话版本 0 → 1），不影响买家。

## 2026-11-19 · 技术栈改进（破坏性重构）

| # | 项目 | 做法 | 测试 |
|---|---|---|---|
| 1 | 异地备份 + 恢复演练 | `ops/backup.sh`：每日备份 + 完整性检查，每周日恢复到临时库核对行数；`offsite`（rclone）加密上传异地，凭据隔离在 `.env.offsite` | 部署时服务器上实测 |
| 2 | CI 构建镜像部署 | CI 测试通过后原生 arm64 构建并推 GHCR（标签 = 提交号）；`deploy.sh` 重写为拉镜像部署，不需本机 Docker，SSH 密钥认证，暂存目录校验后再切换；修复原脚本变量后接全角字符的 bug（CI 已拦截） | CI |
| 3 | 运营通知 | `notifications` 发件箱与业务同事务写入，cron 投递 Telegram；待核实 / 延迟到账 / 卡密不足 / 低库存 | `notify.test`（6 例） |
| 4 | 配置有类型 | `settings` 键值表 → `app_config` 单行 JSON + Zod；逐字段容错、缓存、行锁写入；保存改为整体校验后单事务写入（修复站点设置半保存）；迁移 0002 只搬运密文 | `settings-number.test`、`config-migration.test` |
| 5 | 库存查询 N+1 | 分组子查询 JOIN | 既有用例 |
| 6 | 依赖与运行时 | Dependabot（npm / actions / docker，框架大版本人工）；Node 22 → 24 | Node 24 下全量测试通过 |

部署注意：
- 0002 为破坏性迁移（删除 `settings` 表），部署脚本会先备份。
- 首次部署新流程前，需要该提交的 CI 镜像构建成功。

## 2026-11-19 · 连接池死锁（CI 偶发失败暴露）

| 级别 | 问题 | 修复 | 回归测试 |
|---|---|---|---|
| 高 | 锁卡事务内读配置（低库存通知）。配置缓存为空时要再借一个连接；并发下单占满连接池（max 10）后互相等待直至 10 秒超时，下单全部失败。生产对应「高峰期后台恰好保存设置 / 进程刚重启」。由 Dependabot PR #5 的 CI 偶然撞上 | 阈值在事务开始前读取并传入；排查全部事务回调，无其它事务内借连接的写法 | `pool-exhaustion.test`：栅栏让 10 个事务全部持有连接后清空缓存；撤掉修复稳定复现超时，修复后通过 |

依赖：小版本组、ESLint 10、GitHub Actions 五项升级（Node 24 运行时）可合并 / 已合入；
TypeScript 7（typescript-eslint 尚不支持）与 @types/node 26（运行时为 Node 24）不升级，已在 Dependabot 中忽略其大版本。
