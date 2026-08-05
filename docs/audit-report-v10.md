# LiteShop 完整代码审计报告（第十轮）

**审计范围**：当前 HEAD（commit `5f7a6f5`）  
**审计时间**：2026-08-05  
**审计方式**：静态审查、迁移 SQL、数据一致性与测试覆盖复核

> 当前环境没有 Go 工具链，未执行 `go test`、`go vet`、`go test -race`。

## 一、上一轮问题复核

| 问题 | 状态 |
|---|---|
| 重复 usage 未回退 `used_count` | ⚠️ 部分修复，但当前 SQL 在多组重复数据下仍不正确 |
| 空 `order_no` 阻断唯一索引 | ❌ 当前删除 SQL 会误删空订单号记录，见 P0 |
| 孤儿订单成本回填 NULL | ✅ 已修复 |
| 成本来源标注 | ✅ 已增加 |
| TOTP 旧明文升级 | ✅ 已增加兼容与失败处理 |
| 恢复后 sessions/limiters 清理 | ✅ 已处理 |

## 二、当前发现

### 🔴 P0：迁移 007 的删除条件会误删所有空 `order_no` 记录

当前 SQL：

```sql
DELETE FROM coupon_usages
WHERE id NOT IN (
    SELECT MIN(id)
    FROM coupon_usages
    WHERE order_no <> ''
    GROUP BY order_no
);
```

子查询只返回非空订单号的保留 ID，但外层没有限制 `order_no <> ''`。因此所有 `order_no = ''` 的记录都不在 ID 集合中，会被删除。

这与当前设计“空订单号记录不阻断部分唯一索引”相矛盾，也与测试注释“多条空 order_no 不应阻断”不一致。虽然迁移不会因索引失败，但会静默丢失历史数据。

### 修复

如果要保留空订单号记录，应改为：

```sql
DELETE FROM coupon_usages
WHERE order_no <> ''
  AND id NOT IN (
      SELECT MIN(id)
      FROM coupon_usages
      WHERE order_no <> ''
      GROUP BY order_no
  );
```

并增加迁移测试，确认迁移前后的空订单号数量一致。

---

### 🔴 P0：`used_count` 回退子查询在多个重复订单组时结果不确定

当前 SQL：

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

对于同一优惠券存在多个重复订单组时，相关子查询会返回多行，但 SQLite 标量子查询需要单值。SQLite 在此类情况下通常取其中一行，而不是把所有重复次数求和，导致 `used_count` 回退不足。

例如同一券有：

- `ORD-A` 3 条记录，应回退 2；
- `ORD-B` 2 条记录，应回退 1；
- 总计应回退 3。

当前子查询可能只取到其中一个分组，最终只回退 1 或 2。

### 修复

应先使用聚合子查询得到总重复数：

```sql
UPDATE coupons
SET used_count = MAX(0, used_count - COALESCE((
    SELECT SUM(dupe_count)
    FROM (
        SELECT coupon_id, order_no, COUNT(*) - 1 AS dupe_count
        FROM coupon_usages
        WHERE order_no <> ''
        GROUP BY coupon_id, order_no
    ) d
    WHERE d.coupon_id = coupons.id
), 0));
```

更稳妥的是使用临时表：

1. `CREATE TEMP TABLE coupon_usage_dupes AS ...`；
2. 按 `coupon_id` 汇总应回退数量；
3. 更新 `coupons.used_count`；
4. 删除非最小 ID 的非空重复记录；
5. 创建部分唯一索引。

整个过程应由迁移器事务包裹。

---

### 🟡 P2：迁移测试没有覆盖多个重复订单组

当前 `TestMigration007Dedupe` 只为同一 `order_no='ORD1'` 创建三条记录，无法发现上述标量子查询多行问题。

应增加：

- 同一券 `ORD1` 三条；
- 同一券 `ORD2` 两条；
- 另一张券再有重复记录；
- 多条空 `order_no`；
- 断言迁移后空记录仍存在；
- 断言每张券 `used_count` 与保留 usage 数量一致。

当前 `TestMigration007SQLIntegrity` 只检查 SQL 字符串片段，不能证明 SQL 的数据结果正确，不能替代行为测试。

---

### 🟡 P2：`used_count` 的业务口径仍未完全定义

迁移按重复 usage 数量回退 `used_count`，这是合理方向，但如果旧库的 `used_count` 本身已不可信，仅做差量回退仍可能不准确。

建议迁移后直接按清理后的 usage 记录重算：

```sql
UPDATE coupons
SET used_count = (
    SELECT COUNT(*)
    FROM coupon_usages u
    WHERE u.coupon_id = coupons.id
      AND u.order_no <> ''
);
```

如果空订单号 usage 也代表真实使用，应明确纳入统计；如果它们是无效历史记录，应先归档/删除并记录数量。

---

### 🟢 P3：`cost_source_stats` 查询忽略 `rows.Scan` 错误

`apiAdminSalesReport` 中：

```go
_ = rows.Scan(&src, &cnt)
```

报表属于运营/财务数据，建议检查 `Scan` 错误，并在循环结束后检查 `rows.Err()`。否则数据库字段异常可能静默产生错误统计。

---

## 三、确认做得好的地方

- 孤儿订单成本回填已使用外层 `COALESCE`；
- 已增加成本来源统计接口；
- 已增加迁移行为测试和 SQL 完整性测试；
- 已采用部分唯一索引避免空订单号阻断索引；
- 优惠券重复计数回退方向正确；
- TOTP、session 恢复、成本快照等前序问题保持修复状态。

## 四、发布前要求

必须修复并测试：

1. 删除重复 usage 时增加外层 `order_no <> ''`；
2. 多个重复订单组的 `used_count` 使用聚合总量回退或直接重算；
3. 增加多组重复数据和空订单号的迁移行为测试；
4. 在真实旧数据库副本上执行完整迁移；
5. 执行：

```bash
go test ./...
go vet ./...
go test -race ./...
```

## 五、最终结论

本次修复解决了上一轮提出的索引策略问题，但迁移 007 仍有两个 P0 数据风险：

- 当前删除语句会误删所有空 `order_no` 历史记录；
- `used_count` 回退在同一优惠券存在多个重复订单组时可能少回退。

这两个问题都集中在数据库迁移阶段，必须在发布前修复并使用多组脏数据验证。当前版本暂不建议发布。

**审计人**：AI Assistant  
**报告生成时间**：2026-08-05  
**审计轮次**：10
