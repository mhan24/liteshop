# LiteShop 完整代码审计报告（第七轮）

**审计范围**：当前 HEAD（commit `4179e59`）  
**审计时间**：2026-08-05  
**审计方式**：静态代码审查、数据流审查、迁移/API/权限/错误处理复核

> 当前环境未安装 Go，未执行 `go test`、`go vet`、`go test -race`。以下结论来自当前源码和迁移文件审查。

## 一、上一轮问题复核

| 上一轮问题 | 当前状态 |
|---|---|
| `UseCoupon` 错误被忽略 | ✅ 已修复，失败时释放库存并终止支付流程 |
| 阶梯价依赖 JSON 顺序 | ✅ 已修复，选择最大匹配 `MinQty` 档位并忽略非法档位 |
| 毛利随当前商品成本漂移 | ✅ 已修复，订单保存 `cost_cents` 快照 |
| Webhook secret 无后台入口 | ✅ 已补充保存逻辑及 UI 状态展示 |
| RateLimiter 未清理 | ✅ 已统一实例并由定时任务调用 `Cleanup()` |
| TOTP secret 明文存储 | ✅ 已改为 AES-GCM 加密存储 |
| 优惠券输入校验不足 | ✅ 已补充类型、金额、百分比、次数、过期时间校验 |
| 批量重发无上限 | ✅ 已限制最多 100 单 |

上一轮指出的问题均已得到针对性处理。

## 二、当前仍需处理的问题

### 🟠 P1：TOTP 加密密钥与运行时配置恢复存在失配风险

**涉及文件**：`internal/security/cipher.go`、`internal/web/server.go`、`internal/web/api.go`

TOTP 加密密钥由 `session_secret` 派生：

```go
s.totpCipher = security.NewCipher(s.sessionSecret())
```

系统恢复接口会把备份中的 settings 写回数据库，其中包括 `session_secret`。当前进程中的 `s.totpCipher` 仍使用旧 secret，而 `signSession()` 每次读取数据库中的新 secret，可能造成当前会话失效、session 签名不一致，以及 TOTP cipher 与数据库配置不一致。

**建议**：禁止普通 settings restore 覆盖 `session_secret`；或恢复后清空 sessions 并重建 `totpCipher`。更稳妥的是使用独立的 `totp_encryption_key`，并提供显式密钥轮换流程。

### 🟠 P1：旧版本明文 TOTP secret 没有迁移兼容逻辑

新代码直接调用 `s.totpCipher.Decrypt(totpSecret)`。如果此前版本已启用 TOTP，旧值是 Base32 明文，新代码会把它当作 Base64 密文，导致登录或禁用 2FA 失败。

建议增加 `aesgcm:v1:` 格式前缀，并兼容读取旧明文：旧值验证成功后立即加密回写，完成平滑迁移。发布前必须使用真实旧数据库做升级测试。

### 🟡 P2：优惠券占用与订单创建仍不是一个原子事务

当前顺序是：创建订单并锁卡 → 独立事务占用优惠券 → 调用支付网关。若进程在前两步之间崩溃，订单可能停留在 `created`，卡密与优惠券被占用，只能依赖过期任务或人工处理。

建议为 `coupon_usages.order_no` 增加唯一索引，订单保存 `coupon_id`/`discount_cents` 快照，并增加长期 `created` 订单的补偿清理任务。长期方案是将订单、库存、优惠券占用放入同一 SQLite 事务，支付调用放在事务提交之后。

### 🟡 P2：`RefundByOrderNo` 缺少唯一约束

`coupon_usages.order_no` 没有 UNIQUE 约束，同一订单理论上可产生多条使用记录，回滚时可能多次扣减 `used_count`。

建议增加：

```sql
CREATE UNIQUE INDEX idx_coupon_usage_order ON coupon_usages(order_no);
```

并让回滚返回是否实际发生变化，区分首次回滚与幂等空操作。

### 🟡 P2：迁移 006 对旧数据的成本语义不完整

`cost_cents` 新增列默认 0，旧订单成本全部为 0，历史利润会被高估。建议按迁移时商品成本回填，并明确标注这是“迁移估算”而非真实历史快照。

## 三、工程与安全观察项

1. **TOTP 密文缺少版本前缀**：建议使用 `aesgcm:v1:<base64>`，便于未来轮换算法或密钥。
2. **空 `session_secret` 防护**：`NewCipher("")` 会产生固定密钥，启动阶段应拒绝空 secret。
3. **限流清理生命周期**：当前 ticker 已能工作，但应绑定 server context，支持 graceful shutdown。
4. **批量重发仍同步执行**：虽已限制 100 单，但 SMTP/Telegram 慢时仍会阻塞请求，建议异步 worker。
5. **静默忽略错误仍较多**：`SetOrderStatus`、审计日志、优惠券回滚、通知记录等核心操作不应全部 `_ =`，回滚失败应进入补偿/告警机制。

## 四、测试缺口

应补充：

- 旧明文 TOTP 数据升级与登录；
- 恢复 settings 后 session/TOTP 行为；
- 订单异常中断后的补偿；
- `coupon_usages.order_no` 幂等约束；
- 006 迁移成本回填；
- 非法/乱序批发档位；
- 超大 qty/price 溢出；
- Webhook HMAC 集成测试；
- `go test ./...`、`go vet ./...`、`go test -race ./...`。

## 五、当前评分

| 维度 | 评分 | 评价 |
|---|---|---|
| 架构分层 | ⭐⭐⭐⭐⭐ | 领域拆分清晰 |
| 订单/库存一致性 | ⭐⭐⭐⭐☆ | 主流程可靠，跨事务补偿仍需加强 |
| 营销功能 | ⭐⭐⭐⭐☆ | 功能完整，异常恢复可继续完善 |
| 认证安全 | ⭐⭐⭐⭐☆ | TOTP 加密已实现，但迁移/轮换仍需补齐 |
| 运维性 | ⭐⭐⭐⭐☆ | 配置和限流改善明显，批量通知仍同步 |
| 测试完整度 | ⭐⭐⭐⭐☆ | 核心测试增加，但升级/故障注入不足 |

## 六、修复优先级

| 优先级 | 项目 | 建议 |
|---|---|---|
| P0 | CI 执行完整测试 | 在有 Go 环境的 CI 中跑 `go test/vet/race` |
| P1 | TOTP 旧明文迁移 | 增加兼容读取、加密升级和恢复测试 |
| P1 | session_secret 恢复处理 | 禁止覆盖或恢复后重建 session/cipher |
| P2 | coupon/order 原子性与唯一约束 | 增加唯一索引和补偿清理 |
| P2 | 旧订单成本回填 | 明确历史利润口径 |
| P2 | 错误处理治理 | 核心 DB/审计/回滚错误不可静默忽略 |
| P3 | 批量通知异步化 | 防止后台请求长时间阻塞 |

## 七、最终结论

本次修复已经解决上一轮识别的 P0/P1 业务问题：优惠券占用失败不再继续支付、阶梯价不再依赖输入顺序、毛利使用订单成本快照、TOTP secret 使用 AES-GCM、限流器定期清理、Webhook secret 已形成后台配置闭环。

但当前仍不宜给出“零问题/完全生产就绪”的结论。最重要的剩余风险是 **TOTP 旧明文数据升级兼容** 和 **恢复 `session_secret` 后的运行时密钥失配**。如果项目尚未对外发布，可在首发前补齐；如果已经有启用 TOTP 的生产数据库，应优先验证这两项。

**审计人**：AI Assistant  
**报告生成时间**：2026-08-05  
**审计轮次**：7
