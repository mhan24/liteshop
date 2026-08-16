# 数据库迁移规则

## 强制规则

1. **已发布的迁移不得修改**：只允许新增编号文件，禁止回改/删除已执行过的迁移。
2. **每次数据库变更新增一个文件**：结构变更、索引、数据修复都走迁移。
3. **文件编号不可重复**：`NNN_描述.sql`，编号全局唯一、按序执行。
4. **每个迁移必须能在旧数据库上执行**：只依赖该迁移之前的表结构。
5. **空库初始化与旧库升级都必须测试**：CI 覆盖"全新库 → 最新"与"旧库 → 最新且数据保留"。
6. **数据修复类迁移必须验证影响行数**：先统计匹配行，UPDATE 后校验 affected 与匹配数一致，不一致则迁移失败。
7. **禁止应用启动后静默修改表结构**：所有 DDL 只允许出现在迁移中（`schema.Migrate` 按记录执行一次）。

## 命名

```
001_initial.sql
002_add_order_indexes.sql
003_add_payment_transaction_unique_index.sql
...
```

不要使用 `update.sql / new.sql / fix.sql / final.sql / final2.sql`。

## 迁移执行器

`internal/platform/database/sqlite/schema/`：

- `migrations/*.sql`（根目录）→ 纯 SQL 迁移
- `legacy.go` → 仅 SQLite 无法纯 SQL 表达的存量升级（条件 ALTER / 数据回填），随编号迁移执行一次并记录
- `settings_migrations.go` → 配置结构升级（settings_version）

数据修复（如状态回填）必须像 `backfillOrderStatuses` 一样校验影响行数。
