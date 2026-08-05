# LiteShop 完整代码审计报告（第十二轮 · 全局复核）

**审计范围**：当前 HEAD（commit `df6bc0e`）全量代码  
**审计时间**：2026-08-05  
**审计方式**：全局静态审查（非增量 diff），覆盖后端、迁移、安全、支付回调、前端配置

> 当前环境没有 Go 工具链，未执行 `go test`、`go vet`、`go test -race`。

---

## 一、总体评价

经过 11 轮迭代，LiteShop 已经是一个**架构清晰、安全基线扎实、功能完整**的自动发卡系统：

- 分层架构（web → service → repository → db）执行到位
- 订单状态机、卡密锁定/释放、优惠券、批发价、成本快照均已落地
- TOTP 2FA、AES-GCM 加密、RBAC、审计日志、限流、CSV 注入防护齐备
- 迁移系统带版本追踪与幂等保护

但本轮全局复核发现 **1 个新的 P0 功能性缺陷**，且上一轮（v11）提出的 **迁移 P0 问题仍未修复**。这两个问题都必须在发布前处理。

---

## 二、🔴 P0（新发现）：自定义回调路径与 NotifyURL 不一致，会导致支付回调 404

**文件**：`internal/web/server.go`

回调路由注册使用了可配置路径：

```go
mux.HandleFunc("POST "+s.bepusdtNotifyPath(), s.handleBepusdtNotify)
```

`bepusdtNotifyPath()` 读取 `bepusdt_notify_path` 配置（默认 `/notify/bepusdt`）。

但 `paymentConfig()` 构造发给 BEpusdt 的 `NotifyURL` 时**硬编码了默认路径**：

```go
if v := get("bepusdt_notify_url"); v != "" {
    cfg.NotifyURL = v
} else if publicOverridden {
    cfg.NotifyURL = cfg.PublicBaseURL + "/notify/bepusdt"   // ← 硬编码
}
```

### 后果

管理员一旦通过 `bepusdt_notify_path` 自定义回调路径（这正是该安全功能的目的——隐藏默认路径防扫描/伪造），创建交易时发给 BEpusdt 的 `NotifyURL` 仍指向 `/notify/bepusdt`，而该路径**没有注册路由**：

- BEpusdt 支付成功回调 → 404
- 订单永远停留在 `waiting_payment`
- 买家已付款但收不到卡密 → 严重资损 + 客诉

这个缺陷**直接废掉了回调路径自定义功能**，且比不启用更危险（默认路径下反而正常）。

### 修复

`paymentConfig()` 应使用同一个 `bepusdtNotifyPath()`：

```go
} else if publicOverridden {
    cfg.NotifyURL = cfg.PublicBaseURL + s.bepusdtNotifyPath()
}
```

并确保 `bepusdt_notify_url`（完整 URL）与 `bepusdt_notify_path`（路径）两个配置的优先级关系在文档中写清楚，避免管理员同时配置两者造成混淆。

**必须补充测试**：设置自定义 `bepusdt_notify_path` 后，断言创建交易的 `NotifyURL` 指向该自定义路径。

---

## 三、🔴 P0（v11 遗留，未修复）：迁移 007 跨优惠券重复订单号计数不一致

**文件**：`internal/db/migrations/007_coupon_unique_and_backfill.sql`

回退统计按 `coupon_id + order_no` 分组：

```sql
GROUP BY coupon_id, order_no
```

但删除与唯一索引按全局 `order_no` 分组：

```sql
GROUP BY order_no
```

当同一 `order_no` 出现在**不同优惠券**下时（历史 bug / 手工导入 / 异常重试），回退不会发生，但删除会移除其中一条，导致 `used_count` 与保留 usage 数量不一致。

### 修复方向

以最终唯一键 `order_no` 为准：

1. 建立待删除临时表（每个非空 `order_no` 的非最小 ID 行）
2. 按待删除行的 `coupon_id` 聚合回退数量
3. 更新 `coupons.used_count`
4. 删除重复记录
5. 创建部分唯一索引

或迁移结束后直接按清理后的 usage 重算：

```sql
UPDATE coupons
SET used_count = (
    SELECT COUNT(*) FROM coupon_usages u
    WHERE u.coupon_id = coupons.id AND u.order_no <> ''
);
```

**必须补充测试**：`coupon A + ORD1`、`coupon B + ORD1` 场景，断言被删除记录对应券的 `used_count` 正确减一。

---

## 四、🟡 P2 观察项

### 4.1 迁移使用 TEMP TABLE，需确认迁移器事务边界

007 使用 `CREATE TEMP TABLE` / `DROP TABLE`。迁移器 `runSQLMigration` 在单一事务内逐条 `tx.Exec`，TEMP 表在同一事务/连接内可见，逻辑上可行。但建议：

- 增加“007 在真实迁移器中端到端执行”的测试（当前 `backfill_test.go` 是手工复现 SQL，不是走 `migrateDB`）
- 确认 `splitSQL` 对 `CREATE TEMP TABLE ... AS SELECT`（无内部分号）拆分正确

### 4.2 `cost_snapshot_source` 的 `unknown` 口径

成本为 0 的旧订单仍是 `unknown`，无法区分“真实零成本 / 商品已删 / 无数据”。报表已展示来源统计（做得好），但建议在 UI 上对 `unknown` 利润加警示，避免误读。

### 4.3 空 `order_no` usage 的业务语义未定义

部分唯一索引保留了空订单号记录，但它们是否计入 `used_count`、是否应归档，缺少明确定义。建议在迁移注释和文档中写清。

---

## 五、已确认稳固的部分（无需改动）

| 模块 | 状态 |
|---|---|
| 订单状态机 + 卡密事务 | ✅ 严谨 |
| 优惠券原子占用 + 幂等回滚 | ✅ |
| 阶梯价选择最大匹配档位 | ✅ |
| 成本快照 + 来源标注 | ✅ |
| TOTP AES-GCM + 旧明文兼容升级 | ✅ |
| 恢复禁止覆盖 session_secret + 清空 sessions/limiters | ✅ |
| 限流器统一实例 + 定时清理 | ✅ |
| 超时订单补偿 ExpireStale | ✅ |
| CSV 公式注入防护 | ✅ |
| Webhook HMAC 签名 + 后台配置 | ✅ |
| 回调路径字符校验（防 ServeMux panic） | ✅ |
| RBAC + 审计日志 | ✅ |

---

## 六、发布前必做清单

| 优先级 | 项目 |
|---|---|
| 🔴 P0 | 修复 `paymentConfig()` NotifyURL 使用 `bepusdtNotifyPath()` |
| 🔴 P0 | 修复迁移 007 跨优惠券分组不一致 + 补测试 |
| 🟡 P2 | 增加 007 走真实 `migrateDB` 的端到端迁移测试 |
| 🟡 P2 | 明确空 order_no / unknown 成本的业务口径 |
| ⬜ P0 | 在有 Go 环境的 CI 执行 `go test ./...`、`go vet ./...`、`go test -race ./...` |
| ⬜ P1 | 用真实旧数据库副本完整跑一遍升级 |

---

## 七、最终结论

LiteShop 的代码质量、架构和安全基线已经达到较高水平，前 11 轮发现的绝大多数问题都已妥善修复。但当前仍有 **两个 P0 必须在发布前解决**：

1. **回调路径自定义与 NotifyURL 不一致**（新发现）——会直接导致自定义路径下支付回调 404、买家付款收不到卡密，属于严重资损缺陷，且恰好废掉了该安全功能本身。
2. **迁移 007 跨优惠券计数不一致**（v11 遗留）——历史脏数据升级时会造成券额度错误。

修复这两项并通过完整 CI 与真实库升级验证后，即可进入生产发布评估。

**审计人**：AI Assistant  
**报告生成时间**：2026-08-05  
**审计轮次**：12（全局复核）
