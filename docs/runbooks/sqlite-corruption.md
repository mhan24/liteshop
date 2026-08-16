# Runbook：SQLite 数据库损坏

## 现象

- 健康检查 `database.integrity = error`（`PRAGMA integrity_check` 非 ok）
- 接口出现 SQL 报错（database disk image is malformed 等）

## 处理

1. **停服**：`systemctl stop cardshop`（避免继续写入损坏库）
2. 找到最新可用备份：`/opt/cardshop/data/backups/shop-*.db`（备份已内置完整性校验）
3. 用备份恢复：将最新校验通过的备份复制为 `data/shop.db`
4. 启动并验证：`systemctl start cardshop`，健康检查 `integrity = ok`、`migration_version` 正确
5. 若无可用备份：尝试 `VACUUM INTO` 导出可读部分，并对导出文件做 `integrity_check`；评估数据损失后重建

## 验证

- `/health`：`database.integrity = ok`、`migration_version` 与发布版本一致
- 抽样查询订单/商品/卡密行数与备份前一致
- 关键订单状态机可继续推进（支付回调/补发正常）

## 预防

- 每日自动备份（backup job，保留 7 份）
- 定期抽查 `last_backup` 指标
