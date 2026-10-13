# 运维手册（liteshop）

面向**生产稳定性维护**：支付回调、异常到账、库存一致性、邮件投递、数据库备份。

## 发布流程（务必遵守）

```
改代码 → 本地验证 → git push → CI 通过 → **等用户明确授权** → ./scripts/deploy.sh
```

不要因为「改动小 / CI 通过 / 之前授权过」就自行部署。

本地验证：

```bash
npx tsc --noEmit -p tsconfig.json
npm run lint
npm test
bash -n scripts/deploy.sh && shellcheck --severity=error -e SC1090,SC1091 scripts/deploy.sh
```

## 生产拓扑

| 项 | 值 |
|---|---|
| 服务器目录 | `/opt/liteshop` |
| 容器 | `liteshop-liteshop-1`（应用）、`liteshop-caddy-1`（TLS 反代） |
| 数据卷 | `liteshop_liteshop-data` → `/app/data` |
| 容器运行用户 | `liteshop`（uid **999**） |
| 发布记录 | `/var/lib/liteshop-release/{current,previous,deployed-at}` |
| 备份目录 | `/root/liteshop-backups/`（手工）、`/root/liteshop-backups/daily/`（自动） |
| cron 日志 | `/var/log/liteshop-cron.log` |

## 部署

```bash
./scripts/deploy.sh --dry-run   # 预览（无副作用）
./scripts/deploy.sh             # 交互确认后部署
./scripts/deploy.sh --yes       # 自动化（CI/脚本）
```

脚本保证：

- 用 `git archive HEAD` 打包 → 服务器严格等于该提交（无 macOS AppleDouble 垃圾）
- rsync `--delete` 同步 → 清除上一版本遗留文件
- `.env` 全程排除并前后校验指纹 → 绝不被覆盖
- `docker compose up --wait --timeout 180` → 健康通过才算成功
- 部署后自检运维脚本是否存在、crontab 指向的脚本是否真实存在
- 失败时打印上一版本与回滚命令

**回滚**：`git checkout <先前提交>` → 重新执行 `deploy.sh`。

```bash
ssh root@<host> cat /var/lib/liteshop-release/previous   # 查上一版本
```

## 定时任务

两个脚本**已纳入仓库**（`scripts/ops/`），随部署同步：

| 任务 | 频率 | 作用 |
|---|---|---|
| `expire-cron.sh` | 每 5 分钟 | 触发超时订单清扫（惰性清扫的兜底） |
| `backup-cron.sh` | 每天 03:30 | VACUUM INTO 一致性备份 + 完整性校验 + 清理 14 天前 |

安装/修复（幂等）：

```bash
/opt/liteshop/scripts/ops/install-cron.sh
```

> **历史教训**：这两个脚本原先手工放在 `/opt/liteshop/` 根下且未入库，
> 被 `rsync --delete` 在部署时删除，导致**超时清扫与自动备份同时静默失效**。
> 因此务必保持它们在仓库内，并依赖部署后的自检。

手动执行验证：

```bash
/opt/liteshop/scripts/ops/expire-cron.sh && echo ok
/opt/liteshop/scripts/ops/backup-cron.sh && echo ok
```

## 备份与恢复

### 备份策略

- 每日 03:30 自动执行，落到宿主机 `/root/liteshop-backups/daily/`
- 使用 `VACUUM INTO`：免停机且**正确包含 WAL 中未 checkpoint 的数据**
- 每次备份后自动 `integrity_check` + `foreign_key_check`，失败则删除并报错
  （坏备份比没有备份更危险）
- 保留 14 天

> **不要**用 `cp liteshop.db` 手工备份：WAL 模式下主库可能几乎为空，
> 未 checkpoint 的数据会丢失。

### 恢复演练（已验证，勿在生产卷上直接操作）

```bash
LATEST=$(ls -t /root/liteshop-backups/daily/*.db | head -1)
docker volume create liteshop_restore_test
# 关键：属主必须是容器实际用户 uid 999（不是 100）
docker run --rm --user root -v liteshop_restore_test:/app/data \
  -v /root/liteshop-backups/daily:/b:ro --entrypoint sh liteshop-liteshop:latest \
  -c "cp /b/$(basename $LATEST) /app/data/liteshop.db && chown -R 999:999 /app/data"
docker run -d --name restoretest -p 127.0.0.1:3100:3000 \
  -v liteshop_restore_test:/app/data -e DATA_DIR=/app/data -e NODE_ENV=production \
  -e AUTH_SECRET=<值> liteshop-liteshop:latest
sleep 10
curl -s http://127.0.0.1:3100/api/health          # {"ok":true}
curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:3100/products/voxi   # 200
docker rm -f restoretest && docker volume rm liteshop_restore_test
```

> **演练陷阱**：若属主给成 `100:101`，应用会报
> `SqliteError: attempt to write a readonly database`（因为无法创建 WAL 文件）。
> 这不是备份损坏，而是权限配置错误。生产卷属主是 **999**。

## 稳定性监控要点

| 关注项 | 查看方式 |
|---|---|
| 超时订单堆积 | 后台仪表盘「待对账」；`countOverduePending()` |
| **异常到账待处理** | 后台订单页顶部红色面板 / 仪表盘告警（超时后才到账，需人工补发或退款） |
| 待对账订单 | 后台订单页「待对账」标签（网关可能已建单，**不可**直接关闭释放库存） |
| 邮件投递失败 | `mail_logs` 中 `status='failed'`；cron 每 5 分钟自动重试（最多 5 次） |
| 备份是否正常 | `tail /var/log/liteshop-cron.log`；`ls -lt /root/liteshop-backups/daily/` |
| 回调被限流 | 容器日志 `[notify-ratelimited]`（会回 fail 让网关重试，不丢单） |

常用查询：

```bash
docker exec -w /app liteshop-liteshop-1 node -e "
const d=require('better-sqlite3')('/app/data/liteshop.db',{readonly:true});
console.log('integrity:', d.pragma('integrity_check')[0].integrity_check);
console.log('待对账:', d.prepare(\"SELECT COUNT(*) c FROM orders WHERE status='reconciling'\").get().c);
console.log('异常到账:', d.prepare(\"SELECT COUNT(*) c FROM payment_anomalies WHERE status='open'\").get().c);
console.log('邮件失败:', d.prepare(\"SELECT COUNT(*) c FROM mail_logs WHERE status='failed'\").get().c);
console.log('超时未清:', d.prepare(\"SELECT COUNT(*) c FROM orders WHERE status='pending' AND expiration_time < ?\").get(Date.now()).c);
"
```

## 订单超时的终态

订单超时（本地清扫或网关超时回调）后，会**释放库存并直接把状态置为 `closed`**，
不再停留在 `expired`。

- 原因：超时即视为订单结束，避免在后台与买家页面长期挂在「已超时」需要人工收尾。
- `expired` 仅作为**历史态**保留（状态机、文案、异常到账分支仍支持），
  以便旧数据正常展示与处置。
- 迟到的成功到账不受影响：异常到账分支同时接受 `expired` 与 `closed`，
  仍会登记为待人工处置，**不会**自动发货。
- 附带收益：清扫已把订单置为 `closed` 后，管理员无法再次关闭它，
  「清扫释放 + 手动关闭再释放」这条二次回补路径在状态机层面即不存在。

## 库存一致性（务必理解）

订单的库存/卡密释放**只能**通过 `releaseOrderStock()`（`src/server/delivery/release-stock.ts`）
这一唯一入口，在调用方事务内执行。

它保证两个不变量：

1. **幂等**：以订单为权威状态，释放成功后在同一事务内清除 `stockCharged`；
   重复调用直接跳过。历史缺陷是 7 处调用点各自调用策略 `release()`，
   而 `manual.release()` 只读 `stockCharged` 却从不清除它 ——
   导致「超时清扫释放一次 + 管理员关闭再释放一次」让库存凭空 +1
   （实测 3 → 2 → 3 → **4**），进而超卖。
2. **两类占用的判定方式不同**：
   - `auto`：占用体现在卡密行上（`status='reserved'` + `order_id`），
     按 `order_id` 条件更新，天然幂等。**不能**用 `stockCharged` 判定
     （auto 单该字段恒为 false）。
   - `manual`：占用体现在商品 `stock_limit` 上，`stockCharged` 是权威标志。

### 发货方式以订单快照为准

订单创建时保存 `delivery_type` 快照（迁移 0007）。履约与释放一律走
`getOrderDeliveryType()`（优先快照、历史订单回落商品值），**不要**直接读
`product.deliveryType` —— 商品类型可被后台修改，历史订单不应被追溯改变性质。
否则会出现「manual→auto 后人工库存不回补」或「auto→manual 后预留卡密不释放」。

### 库存模式切换（有限 ↔ 不限）

管理员在后台把商品的库存模式从「有限」改为「不限」（或反向）时，
系统会在同一事务内**重置该商品所有订单的 `stockCharged`**，
即视为"管理员手动接管库存数量"，历史订单不再回补。

原因：无预留台账时无法区分"库存 3 是管理员手填的"还是"3 是剩余量"。
若不重置，「有限 → 不限 → 有限」序列会让过期订单额外回补一份
（实测 3 → 4，库存虚高、潜在超卖）。

注意区分：
- **切换模式**（有限 ↔ 不限）→ 重置占用
- **仅调整数量**（有限 3 → 有限 10，即补货）→ 不重置，订单过期仍正常回补

彻底消除这类歧义需要独立的预留台账（reservation ledger），属架构级改动，当前未实施。

## 重新购买的状态白名单

重新购买**只允许** `expired` / `closed`（`REPURCHASE_ALLOWED_STATUSES`）。

白名单在**服务层**（`createOrderForRepurchase`）与 Action 层双重校验 ——
不能只依赖前端按钮，否则将来新增的服务调用入口会被静默放行。

特别地，`reconciling`（待对账）**禁止**重购：旧交易是否创建、是否已付款
仍未确定，重购会再次占用库存，且买家可能为同一笔订单重复付款。

除状态白名单外，还必须在**服务层**排除两类「钱的问题」
（`repurchaseBlockedReason`）：

1. **已收款**（`paidAt` 非空）：状态机允许 `paid → closed`，因此仅凭 status
   判断不出是否收过钱。已付款后关闭的订单若允许重购，会误导买家再次支付。
2. **有未处理的异常到账**（`payment_anomalies.status = 'open'`）：
   超时订单收到延迟成功回调时会登记待人工处置，此时买家是否付款未核实，
   允许重购会让买家重复付款。

这两类判断不能只放在前端按钮上：绕过页面的直接调用同样要拦住。

## 限流与客户端 IP

- 登录限流有两个维度：**IP+用户名**（5 次/15 分钟）与**仅 IP**（20 次/15 分钟）。
  后者用于防止轮换用户名绕过；记录有 TTL（1 小时）与容量上限（5000，批量淘汰）。
- 客户端 IP 一律经 `src/server/security/client-ip.ts` 解析：
  取 `X-Forwarded-For` 的**最后一段**（受信代理 Caddy 写入）。
  **不要**取第一段 —— 那是客户端可控值，攻击者每次换一个假 IP 即可绕过 IP 限流。
- 若将来在 Caddy 前再加一层 CDN/代理，需同步调整 `TRUSTED_PROXY_HOPS`。

## 关键业务规则（改代码时勿破坏）

1. **回调应答语义**：未真正处理时**绝不能**回 `success`（网关会停止重试 → 静默丢单）。
   限流/异常一律回 `fail`；只有确定性失败（验签不过、金额不符）才回 `success`。
2. **异常到账不自动恢复原订单**：清扫已释放卡密，可能已被他人买走，
   直接发卡会一卡多卖。必须人工核对后「补发」（从卡池重新取卡）或退款。
3. **reconciling 不可用通用关闭释放库存**：必须经「确认未建单」核对网关。
4. **manual 库存防重复计数**：转入人工发货时按 `stockCharged` 判断是否重新占用，
   并复位标记，使后续关单只回补一次。
5. **金额一律按币种最小单位比较**：JPY 是零小数币种，传网关与比较都不能 /100。
6. **校验先于副作用**：任何状态变更或异常登记之前，必须先验证 trade_id 归属与金额。
7. **库存释放必须走统一入口**：见上文「库存一致性」。
8. **发货方式读订单快照**，不读商品当前配置。
9. **同一个事务内失败的语句不会回滚先前成功的写操作**：需要"重试"语义时
   （如订单号冲突重试）必须用 `SAVEPOINT`，否则先前的库存扣减会累积。

## 重复付款与网关令牌轮换

- 已完成订单，或已由另一笔交易确认收款的订单，收到尚未记为 paid 的成功交易通知时，登记 `duplicate_payment` 异常；该笔交易独立记录，不再次发货。管理员核对链上到账后退款或关闭误报，系统不会自动转账退款。
- 传统订单缺少支付尝试记录时沿用已支付交易快照；如有另一笔款项的补发记录，不再仅凭订单完成状态忽略新回调。
- 全局 `pending + reconciling` 的 200 笔容量在建单 IMMEDIATE 事务内复核。待对账达到 20 笔时阻止新建单；这是熔断阈值，已经受理的支付创建请求随后转入待对账时仍须保留，不能为追求该阈值释放可能已生效的支付库存。
- 轮换 bepusdt API 令牌前核对未结束交易及网关的新旧令牌验证策略，确认旧交易回调可继续验签，必要时安排维护窗口并保留人工对账记录。本轮没有使用真实网关验证其轮换行为。
