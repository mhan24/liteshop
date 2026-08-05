# LiteShop 完整代码审计报告（第十一轮）

**审计范围**：当前 HEAD（commit `df6bc0e`）  
**审计时间**：2026-08-05  
**审计方式**：静态审查、迁移 SQL、数据一致性与测试覆盖复核

> 当前环境没有 Go 工具链，未执行 `go test`、`go vet`、`go test -race`。

## 一、上一轮问题复核

| 问题 | 状态 |
|---|---|
| 空 `order_no` 被误删 | ✅ 已修复，删除语句增加 `order_no <> ''` |
| 多组重复记录回退不完整 | ✅ 已修复，使用临时表聚合 `dupe_count` |
| 空订单号阻断索引 | ✅ 已改为部分唯一索引 |
| 销售报表忽略 `Scan`/`rows.Err` | ✅ 已修复 |
| 多组重复、空订单号测试 | ✅ 已补充 |

## 二、当前发现

### 🔴 P0：迁移去重按全局 `order_no` 保留记录，但 `used_count` 回退按 `coupon_id + order_no` 计算，跨优惠券重复时会产生数据不一致

迁移删除逻辑是全局唯一订单号：

```sql
SELECT MIN(id)
FROM coupon_usages
WHERE order_no <> ''
GROUP BY order_no
```

这与最终的唯一索引一致：`order_no` 在所有优惠券之间全局唯一。

但回退统计使用：

```sql
GROUP BY coupon_id, order_no
```

这两套分组规则不一致。

#### 具体场景

历史脏数据：

| id | coupon_id | order_no |
|---:|---:|---|
| 1 | A | ORD-1 |
| 2 | B | ORD-1 |

当前回退聚合结果：

- A 的 `ORD-1` 只有 1 条，不回退；
- B 的 `ORD-1` 只有 1 条，不回退。

当前删除逻辑：保留 id=1，删除 id=2。

最终结果：

- coupon A 的 `used_count` 不变；
- coupon B 的 `used_count` 不变；
- coupon B 的 usage 记录消失；
- `used_count` 与保留 usage 数量不一致。

这类数据可能来自历史 bug、手工导入或异常重试，迁移代码必须安全处理，不能假设脏数据只会在同一优惠券内重复。

#### 修复方向

必须统一“保留/回退”的分组规则。推荐在临时表中按最终唯一键 `order_no` 选择保留行，并记录被删除行对应的 `coupon_id`：

1. 建立待删除记录临时表：所有非最小 `id` 的非空 `order_no` 行；
2. 按待删除行的 `coupon_id` 聚合回退数量；
3. 更新 `coupons.used_count`；
4. 删除待删除记录；
5. 创建部分唯一索引；
6. 迁移测试覆盖同一 `order_no` 跨不同 coupon 的场景。

同时应明确业务规则：一个订单号只能使用一张券，因此遇到跨券冲突时保留最早记录是合理的，但必须回退被删除记录对应券的用量。

---

### 🟡 P2：迁移测试仍未覆盖跨 coupon 相同 `order_no`

当前测试覆盖了：

- 同一券多个订单组；
- 多个空订单号；
- 部分唯一索引。

但没有覆盖：

```text
coupon A + ORD1
coupon B + ORD1
```

应增加断言：

- 只保留一条；
- 被删除行对应的券 `used_count` 正确减一；
- 最终唯一索引创建成功。

---

### 🟡 P2：迁移后的 `used_count` 最好进行最终一致性校验

即使修复跨 coupon 冲突，历史 `used_count` 可能早已与 usage 表不一致。仅做“删除重复行的差量回退”只能修复已识别的重复，无法修复未知历史损坏。

建议迁移结束后增加校验或重算策略：

```sql
UPDATE coupons
SET used_count = (
    SELECT COUNT(*)
    FROM coupon_usages u
    WHERE u.coupon_id = coupons.id
      AND u.order_no <> ''
);
```

如果空订单号记录具有业务意义，应先定义是否计入，并在注释、测试和报表中保持一致。

---

## 三、当前实现的优点

- 外层删除条件已限制非空订单号，不再误删空记录；
- 临时表聚合解决了同一 coupon 多个重复订单组的问题；
- 部分唯一索引与历史空订单号兼容；
- 新增测试验证多组重复、计数回退、空记录保留；
- 销售报表已处理 `Scan` 和 `rows.Err`；
- TOTP、恢复、成本快照等前序问题保持修复。

## 四、发布前要求

必须补充并通过：

1. 跨 coupon 相同 `order_no` 的迁移测试；
2. 被删除 usage 对应券的 `used_count` 回退测试；
3. 迁移后 `used_count` 与保留 usage 数量一致性校验；
4. 真实旧数据库副本升级测试；
5. 完整 CI：

```bash
go test ./...
go vet ./...
go test -race ./...
```

## 五、最终结论

本轮已正确修复上一轮提出的空记录误删、多组重复回退和报表错误处理问题，但迁移 007 仍存在一个 **P0 数据一致性风险**：

> 去重按全局 `order_no`，计数回退按 `coupon_id + order_no`，跨优惠券同订单号时会导致 `used_count` 错误。

在修复该分组规则不一致并增加对应迁移测试前，仍不建议发布当前版本。

**审计人**：AI Assistant  
**报告生成时间**：2026-08-05  
**审计轮次**：11
