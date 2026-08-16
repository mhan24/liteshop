# Runbook：支付回调连续失败

## 现象

- `logs/payment.log` 持续出现 `callback verify failed`
- 买家已付款，但订单仍停留在 `waiting_payment`

## 排查

1. 检查回调路径：`notify_url` 必须公网可达（Caddy/Cloudflare 已正确代理 `/notify/*`）
2. 检查网关密钥是否变更（token / HashPay 商户私钥），与网关后台配置一致
3. 查看日志中的 `request_id` 定位具体失败原因（验签失败 / 解密失败 / 时间戳超窗）

## 处理

1. 修正配置（后台支付设置）后保存，配置即时生效（回调路径动态匹配，无需重启）
2. 若为偶发（如时间戳窗口），等待网关重试即可——幂等台账保证重复回调无副作用
3. 若订单确实已支付但确认失败：人工核对网关后台后，走补发流程补齐状态
4. 若 outbox 事件进入 `dead_events`：按 `admin/jobs` 查看死信，排查消费者失败原因后重放/人工处理

## 验证

- 新回调验签通过、订单进入 `paid` 并发卡
- `processed_events` 无重复处理
- 死信事件不再增长
