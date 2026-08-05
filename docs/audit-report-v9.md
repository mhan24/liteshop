# LiteShop 完整代码审计报告（第九轮）

**审计范围**：当前 HEAD（commit `f751c61`）  
**审计时间**：2026-08-05  
**审计方式**：静态审查、迁移 SQL、数据一致性和异常路径复核

> 当前环境没有 Go 工具链，未执行 `go test`、`go vet`、`go test -race`。

## 一、上一轮问题复核

| 问题 | 状态 |
|---|---|
| 迁移 007 孤儿订单回填可能写入 NULL | ✅ 已修复，使用外层 `COALESCE` |
| 历史成本来源缺少标注 | ✅ 新增 `cost_snapshot_source` |
| 旧明文 TOTP 升级错误被忽略 | ✅ 升级失败会中断登录并记录系统通知 |
| 恢复后限流状态残留 | ✅ 恢复后清空 sessions 和 limiters |
| `ExpireStale` 动态拼接状态值 | ✅ 已改为固定 SQL |
| 迁移重复 coupon usage | ⚠️ 有去重处理，但仍有数据一致性缺陷，见下文 |

## 二、当前发现

### 🔴 P0：迁移 007 去重没有同步修正 `coupons.used_count`

迁移注释声明会“回退多余记录对应券的 `used_count`”，但实际 SQL 只删除重复使用记录：

```sql
DELETE FROM coupon_usages
WHERE id NOT IN (
    SELECT MIN(id) FROM coupon_usages GROUP BY order_no
) AND order_no != '';
```

没有对被删除记录对应的优惠券执行 `used_count - 1`。

#### 影响

如果旧库存在同一订单 3 条 usage 记录：

- `coupon_usages` 清理后只剩 1 条；
- `coupons.used_count` 仍然可能是 3；
- 后续可用次数被永久少算，甚至优惠券被错误判定为用尽；
- 数据库迁移虽然成功，但营销数据和额度不一致。

#### 建议

迁移前先把待删除记录聚合并回退对应券的计数，再删除：

```sql
UPDATE coupons
SET used_count = MAX(0, used_count - (
    SELECT COUNT(*) - 1
    FROM coupon_usages u
    WHERE u.coupon_id = coupons.id
      AND u.order_no <> ''
    GROUP BY u.coupon_id, u.order_no
));
```

实际实现建议使用临时表保存待删除记录，避免 SQLite 相关子查询难以验证：

1. 建立临时表记录待删 `coupon_id`；
2. 按券聚合待退数量；
3. 更新 `used_count`，下限为 0；
4. 删除重复 usage；
5. 创建唯一索引；
6. 在迁移测试中断言 `used_count` 与 usage 数量一致。

---

### 🔴 P0：空 `order_no` 的历史 usage 会使唯一索引创建失败

当前去重条件明确排除了空订单号：

```sql
AND order_no != ''
```

但随后创建的是对整列 `order_no` 的唯一索引：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order
ON coupon_usages(order_no);
```

SQLite 唯一索引允许多个 `NULL`，但不允许多个空字符串 `''`。如果历史库有两条或以上 `order_no=''` 的 usage，迁移会因唯一约束失败。

这与迁移测试当前只验证正常 `ORD1` 重复、未验证空订单号形成了覆盖缺口。

#### 建议

选择并明确一种策略：

- 删除/归档 `order_no=''` 的无效 usage；或
- 将空订单号转换成唯一的迁移标识；或
- 使用部分唯一索引，只约束非空订单号：

```sql
CREATE UNIQUE INDEX IF NOT EXISTS idx_coupon_usage_order
ON coupon_usages(order_no)
WHERE order_no <> '';
```

推荐最后一种，同时保留空订单号历史数据不阻断迁移。

---

### 🟡 P2：迁移 007 未使用显式事务保护整组操作

迁移器对 SQL 文件虽然在事务中执行，但当前 `splitSQL` 按分号执行多条语句，需确认整个 SQL migration 的事务边界和失败回滚行为。建议迁移测试模拟：

- 去重成功；
- 建唯一索引失败；
- 后续成本回填失败；

最终应验证前面的删除和计数更新也全部回滚，不能留下半完成状态。

---

### 🟡 P2：`cost_snapshot_source` 的回填条件会把“真实零成本”留为 `unknown`

迁移 008：

```sql
UPDATE orders
SET cost_snapshot_source = 'migration_estimate'
WHERE cost_cents > 0;
```

这符合“正成本订单为迁移估算”的策略，但成本为 0 的旧订单仍是 `unknown`，无法区分：

- 商品确实零成本；
- 商品已删除；
- 旧库没有成本数据。

这不是阻断问题，但报表和财务口径应明确：`unknown` 不应被当作真实零成本参与利润结算。

建议报表展示成本来源统计，并对 `unknown` 利润加警示。

---

### 🟡 P2：迁移 007 依赖 `used_count` 初始值可信

即使补上重复记录回退逻辑，若旧库的 `used_count` 已经与 usage 表不一致，按“删除重复数”调整仍不能完全修复数据。

更可靠的迁移策略是：

```sql
UPDATE coupons
SET used_count = (
    SELECT COUNT(*)
    FROM coupon_usages
    WHERE coupon_usages.coupon_id = coupons.id
);
```

但需要先定义是否统计空 `order_no`、是否保留退款记录。当前 usage 表没有 `refunded_at`/状态字段，建议在迁移注释中明确语义。

## 三、验证做得好的地方

- 迁移 007 的孤儿订单回填已使用外层 `COALESCE`；
- 新增 backfill 测试覆盖正常商品、孤儿订单和成本来源列；
- TOTP 旧明文支持兼容读取并在验证后升级；
- TOTP 升级写入失败不再静默放行；
- 恢复配置后同时清空 sessions 和限流器；
- `cost_snapshot_source` 将新订单标记为 `order_time`；
- 超时订单补偿逻辑已加入定时任务；
- `ExpireStale` 已移除不必要的动态 SQL 拼接。

## 四、发布前必须补充的测试

```text
迁移 007：多条相同非空 order_no + used_count 校正
迁移 007：多条空 order_no 不阻断唯一索引
迁移 007：索引失败时整组操作回滚
迁移 008：正常成本、零成本、孤儿商品三类来源
优惠券：并发使用、支付失败回滚、重复回滚
TOTP：旧明文升级失败、恢复后登录、密文格式版本
完整：go test ./...、go vet ./...、go test -race ./...
```

## 五、修复优先级

| 优先级 | 问题 | 建议 |
|---|---|---|
| P0 | 重复 usage 删除未回退 `used_count` | 迁移前聚合校正或按 usage 重算 |
| P0 | 空 `order_no` 可能使唯一索引失败 | 使用部分唯一索引或清理空值 |
| P2 | 迁移全流程回滚验证 | 增加故障注入迁移测试 |
| P2 | unknown 成本来源报表口径 | 明确并展示估算/未知数据 |

## 六、最终结论

当前版本已经修复上一轮的孤儿订单迁移阻断、TOTP 迁移兼容、恢复密钥处理等主要问题，但迁移 007 仍存在两个发布阻断风险：

1. 清理重复优惠券使用记录后没有同步修正 `used_count`；
2. 空 `order_no` 历史记录可能导致唯一索引创建失败。

在真实旧数据库升级验证通过前，不建议发布该迁移版本。

**审计人**：AI Assistant  
**报告生成时间**：2026-08-05  
**审计轮次**：9
