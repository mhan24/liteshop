# storefront E2E

用例文件规划（Playwright）：

- `browse.spec.ts`：首页浏览、搜索、筛选、商品详情
- `checkout.spec.ts`：下单 → 模拟支付回调 → 查看卡密
- `order-query.spec.ts`：邮箱查询、发送/重发查看链接
- `cancel.spec.ts`：取消未支付订单
