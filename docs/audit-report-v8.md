# LiteShop 完整代码审计报告（第八轮）

**审计范围**：当前 HEAD（commit `ff8cb51`）  
**审计时间**：2026-08-05  
**审计方式**：静态代码审查、迁移/API/数据一致性复核

> 当前环境没有 Go 工具链，未执行 `go test`、`go vet`、`go test -race`。本报告基于当前源码和迁移文件。

## 一、上一轮问题复核

| 问题 | 状态 |
|---|---|
| TOTP 旧明文兼容与成功后升级 | ✅ 已实现 |
| 恢复时覆盖 `session_secret` | ✅ 已禁止，并清空 sessions |
| `coupon_usages.order_no` 唯一约束 | ✅ 已增加迁移 |
| 旧订单成本回填 | ⚠️ 已增加，但 SQL 存在边界缺陷，见下文 |
| 空 `session_secret` | ✅ `NewCipher` 拒绝空值 |
| 超时订单补偿清理 | ✅ `ExpireStale` + 定时任务 |
| 回滚错误静默忽略 | ✅ 主要回滚路径已记录订单日志 |

## 二、当前发现

### 🔴 P0：迁移 007 对“无对应商品”的旧订单可能失败

**文件**：`internal/db/migrations/007_coupon_unique_and_backfill.sql`

当前 SQL：

```sql
UPDATE orders SET cost_cents = (
    SELECT COALESCE(p.cost_cents, 0)
    FROM products p
    WHERE p.id = orders.product_id
) WHERE cost_cents = 0;
```

注释声明“无对应商品的订单保持 0”，但 SQL 实际并非如此：

- 若子查询找不到商品，SQLite 标量子查询返回 `NULL`；
- `orders.cost_cents` 是 `NOT NULL`；
- 更新孤儿订单时可能触发 `NOT NULL constraint failed`；
- 数据库迁移失败，应用无法启动。

### 修复

使用外层 `COALESCE`：

```sql
UPDATE orders
SET cost_cents = COALESCE(
    (SELECT p.cost_cents
     FROM products p
     WHERE p.id = orders.product_id),
    0
)
WHERE cost_cents = 0;
```

并增加迁移测试：

1. 正常商品订单能回填成本；
2. 商品已删除的订单仍保持 0；
3. 重复打开数据库迁移保持幂等；
4. `cost_cents` 的 NOT NULL 约束不被违反。

这是当前唯一发现的阻断性问题，发布前必须修复。

---

### 🟡 P2：成本回填会覆盖真实的零成本快照

迁移使用 `WHERE cost_cents = 0`。但新订单中 `cost_cents=0` 可能是合法值，例如免费库存、成本未知或确实零成本商品。再次运行迁移或后续数据修复时，会把这类订单成本更新为当前商品成本，历史利润仍可能漂移。

建议增加来源字段：

```sql
cost_snapshot_source TEXT NOT NULL DEFAULT 'unknown'
```

区分：

- `order_time`：下单时真实快照；
- `migration_estimate`：迁移时按当前商品估算；
- `unknown`：无法确定。

至少应保证迁移只执行一次（当前 schema migration 已有版本记录），并在文档中明确旧订单成本是估算值。

---

### 🟡 P2：TOTP 旧明文升级失败仍允许登录

当前旧明文升级流程是：

1. 用旧值验证 OTP；
2. 生成 AES-GCM 密文；
3. `UPDATE admins SET totp_secret = ...`；
4. 忽略更新错误；
5. 仍然创建登录 session。

如果数据库更新失败，管理员本次登录成功，但旧明文仍继续存在。之后每次登录都会重复尝试升级，无法发现迁移失败。

建议：

- 更新失败时记录安全告警；
- 返回 500 或至少标记“迁移待处理”；
- 不要静默忽略 `UPDATE` 错误；
- 增加旧明文升级失败测试。

---

### 🟡 P2：恢复接口清空 sessions，但不清理 2FA/限流状态及正在运行的补偿任务

清空普通 sessions 是正确的，但配置恢复后：

- 已签发的 2FA 临时 token 也只是被删除，客户端会收到过期错误，属于可接受行为；
- 限流器状态仍保留，恢复后管理员可能继续受到旧 IP 限流影响；
- 后台定时补偿任务可能正好与恢复操作并发执行，存在配置恢复与订单过期操作交错的窗口。

建议恢复操作后同时清空限流器，必要时使用恢复锁或短暂禁止后台写操作。

---

### 🟢 P3：`ExpireStale` 的查询条件由字符串拼接生成

当前使用：

```go
`status IN ('`+models.OrderCreated+`','`+models.OrderWaitingPayment+`') AND created_at < ?`
```

当前两个常量是内部固定值，实际没有 SQL 注入风险；但这种写法容易被后续维护者复制到用户输入场景。建议改成固定 SQL：

```sql
status IN ('created', 'waiting_payment') AND created_at < ?
```

或者使用明确的常量查询构造器。

---

### 🟢 P3：`RefundByOrderNo` 的唯一索引迁移对脏数据缺少预处理

如果历史数据库已经存在同一 `order_no` 的多条 `coupon_usages` 记录，创建唯一索引会失败，导致迁移无法完成。当前代码假设历史数据始终干净，但前几版没有唯一约束，理论上重复记录可能存在。

建议迁移 007 在建索引前先：

1. 按 `order_no` 聚合重复记录；
2. 保留一条 usage；
3. 回退多余 usage 对应的 `used_count`；
4. 再创建唯一索引；
5. 将清理数量写入日志或迁移结果。

---

## 三、验证做得好的地方

- TOTP 使用 `aesgcm:v1:` 前缀，并兼容旧明文；
- TOTP 密钥派生拒绝空 `session_secret`；
- 恢复接口禁止覆盖 `session_secret`，避免 session/cipher 失配；
- 优惠券使用原子递增，回滚具备幂等返回值；
- 超时订单有定时补偿，释放卡密并回滚优惠券；
- 成本快照已贯穿订单插入、查询和仪表盘统计；
- 批量重发已设置 100 单上限；
- 主要错误路径已经从静默忽略改为订单日志告警。

## 四、测试要求

发布前必须在 CI 执行：

```bash
go test ./...
go vet ./...
go test -race ./...
```

建议新增或确认：

- 迁移 007 孤儿订单回填测试；
- 迁移 007 重复 coupon usage 清理测试；
- 旧明文 TOTP 更新失败测试；
- 恢复后 sessions/限流状态测试；
- 超时订单补偿与优惠券回滚测试。

## 五、最终结论

本次修复已经完成上一轮的大部分安全与一致性改进，但当前仍存在一个明确的 **P0 迁移阻断问题**：迁移 007 对商品不存在的旧订单可能写入 NULL，违反 `cost_cents NOT NULL`，导致数据库升级失败。

修正外层 `COALESCE` 并通过迁移测试后，当前版本再进行下一轮生产发布评估。

**审计人**：AI Assistant  
**报告生成时间**：2026-08-05  
**审计轮次**：8
