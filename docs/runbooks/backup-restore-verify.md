# Runbook：备份恢复后校验

## 备份机制

- 每日 `backup` 任务执行 `VACUUM INTO` 一致性快照到 `data/backups/`
- 备份后自动只读打开并执行 `PRAGMA integrity_check`，校验失败立即删除坏文件

## 恢复步骤

1. 停服
2. 选择校验通过的备份（可先对候选文件手动执行 `PRAGMA integrity_check`）
3. 替换 `data/shop.db`（保留原损坏文件以便取证）
4. 启动

## 恢复后校验清单

- `/health`：`integrity=ok`、`migration_version` 与代码匹配、`last_backup` 存在
- 关键表行数：orders / cards / products / admins（抽样对比）
- 后台可登录、订单可查询、支付回调路径可达
- 启动日志无迁移失败、无 outbox 死信新增
