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
