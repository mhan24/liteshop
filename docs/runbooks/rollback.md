# Runbook：新版本部署失败回滚

## 前置

- 部署前保留当前二进制：`/opt/cardshop/shop.bak.<时间戳>`（自动生成）
- 数据库备份在 `data/backups/`

## 回滚步骤（代码/二进制回滚）

1. 记录失败现象（启动失败 / 健康检查异常 / 接口 5xx）
2. 停服：`systemctl stop cardshop`
3. 恢复旧二进制：`cp shop.bak.<ts> shop && chown cardshop:cardshop shop`
4. 启动：`systemctl start cardshop`
5. 验证：`/health` 200、版本号回退、关键流程（下单/支付回调）正常

## 数据库迁移回滚

- 迁移已执行并记录在 `schema_migrations`，**不要**手工删除记录（会破坏一致性）
- 若新迁移导致数据问题且无法向前修复：从 `data/backups/` 恢复迁移前备份（迁移前先手动备份一份是安全习惯）
- 恢复后核对 `migration_version` 与代码匹配

## 验证

- 旧版本服务启动无报错
- 健康检查指标正常
- 用真实交易冒烟：创建订单 → 模拟支付回调 → 查看卡密
