# 订单状态机

## 状态定义

| 状态 | 含义 |
|---|---|
| created | 订单记录已创建（尚未生成支付交易） |
| waiting_payment | 已创建支付交易，等待支付 |
| paid | 支付成功，开始发卡 |
| processing | 发卡处理中（瞬态） |
| pending_delivery | 已支付，等待人工发货（人工交付商品） |
| delivered | 卡密已发放 |
| completed | 已完成（终态） |
| payment_failed | 支付异常（建单失败，终态） |
| delivery_failed | 发卡失败，待后台处理（终态，可补发） |
| cancelled | 已取消（终态） |
| expired | 支付超时过期（终态） |

支付状态独立（`payment_status`：created/pending/confirmed/failed/cancelled），订单状态描述履约生命周期。

## 允许转换

```
created ──> waiting_payment | payment_failed | cancelled | expired
waiting_payment ──> paid | cancelled | expired
paid ──> processing | pending_delivery | delivery_failed
pending_delivery ──> delivered
processing ──> delivered | delivery_failed
delivered ──> completed
```

## 禁止转换（示例）

- paid / processing → completed（必须经过 delivered，防止漏发货）
- waiting_payment → processing / delivered
- expired / cancelled / completed → 任何其他状态
- 已支付订单不可取消/过期（条件状态迁移兜底）

## 触发来源

| 动作 | 来源 |
|---|---|
| created → waiting_payment | 下单用例（CreateOrder） |
| waiting_payment → paid / pending_delivery | 支付回调（HandlePaymentCallback） |
| paid → delivered / delivery_failed | 发卡用例（MarkPaidAndDeliver） |
| created/waiting_payment → cancelled | 用户/管理员取消（Cancel） |
| created/waiting_payment → expired | 定时任务（ExpireStale → 应用用例） |
| pending_delivery → delivered | 管理员人工发货（ManualDeliver） |
| delivery_failed → delivered | 补发（Redeliver） |

## 事务边界

- 下单：单事务内“建单 + 锁卡密”，失败回滚（不残留锁定库存）
- 支付成功：单事务内“waiting_payment→paid + 卡密 locked→sold + 写 outbox 事件”，提交后才异步发通知
- 取消/过期：单事务内“条件状态迁移 + 释放卡密 + 回滚优惠券”
- 幂等：processed_events（回调唯一键）与状态变更同事务；晚到回调 noop

## 异常补偿

- 支付成功但发卡为 0 → `delivery_failed` + 系统告警，后台补发（Redeliver 重新锁卡+售出+重发）
- 支付回调连续失败 → outbox/回调日志告警；幂等台账保证重试安全
- 进程崩溃后：`order_expire` / `email_retry` / `cleanup` 启动即跑一次补偿；outbox 启动补发未发布事件
- 卡密锁定但订单终态（崩溃窗口）→ 过期/清理任务释放预留卡密
