# Changelog

## 0.1.0 (2026-08-07) — First official release / 首个正式版

English / 中文：

### Features / 功能

- Automated card delivery + BEpusdt USDT payments (create/cancel transactions, callback verification, idempotent delivery) / 自动发卡 + BEpusdt USDT 支付（创建/取消交易、回调验签、幂等发卡）
- Nuxt 3 SSR storefront: product listing/detail, order lookup, payment polling, email-delivered card view links, SEO / 前台 Nuxt 3 SSR：商品列表/详情、订单查询、支付轮询、卡密邮件化查看链接、SEO
- Vue 3 admin SPA: products/cards/orders/coupons/wholesale/notifications/site/admins/audit/TOTP / 后台 Vue 3 SPA：商品/卡密/订单/优惠券/阶梯价/通知/站点/管理员/审计/TOTP
- Maintenance mode, config backup/restore, sales report and dashboard / 维护模式、配置备份/恢复、销售报表与仪表盘

### Security baseline / 安全基线

- PBKDF2-SHA256 (100k) passwords, TOTP 2FA (AES-GCM encrypted) / PBKDF2-SHA256（10 万次）密码、TOTP 2FA（AES-GCM 加密）
- Order view tokens (email-only delivery), atomic order state machine (deliver/cancel/expire in single transactions) / 订单查看令牌（只经邮件下发）、订单状态机原子化（发卡/取消/过期单事务）
- RBAC (admin/operator/viewer) + audit logs, rate limiting across endpoints, Turnstile / RBAC + 审计日志、全接口限流、Turnstile
- Parameterized SQL, CSV injection guard, admin CSP, HSTS, security headers / SQL 全参数化、CSV 注入防护、后台 CSP、HSTS、安全响应头
- Backups exclude secret keys; persisted sessions revoked immediately on deletion/logout / 备份不包含密钥类配置；会话持久化 + 删号/登出即时吊销

### Deployment / 部署

- Go 1.26 + SQLite (modernc latest), single zero-dependency binary / Go 1.26 + SQLite（modernc 最新），单二进制零依赖
- Docker / one-click install.sh: non-root, UMask=0077, data files 600, Caddy auto-HTTPS / Docker / 一键 install.sh：非 root 运行、UMask=0077、数据文件 600、Caddy 自动 HTTPS

### Dependencies / 依赖

- storefront / admin-ui `npm audit`: 0 known vulnerabilities / 0 已知漏洞

---

## 0.1.0（2026-08-07）— 首个正式版

LiteShop 首个官方发布版本。

### 功能

- 自动发卡 + BEpusdt USDT 支付（创建/取消交易、回调验签、幂等发卡）
- 前台 Nuxt 3 SSR：商品列表/详情、订单查询、支付轮询、卡密邮件化查看链接、SEO
- 后台 Vue 3 SPA：商品/卡密/订单/优惠券/阶梯价/通知/站点/管理员/审计/TOTP
- 维护模式、配置备份/恢复、销售报表与仪表盘

### 安全基线

- PBKDF2-SHA256（10 万次）密码、TOTP 2FA（AES-GCM 加密）
- 订单查看令牌（只经邮件下发）、订单状态机原子化（发卡/取消/过期单事务）
- RBAC（viewer/operator/admin）+ 审计日志、全接口限流、Turnstile 人机验证
- SQL 全参数化、CSV 注入防护、后台 CSP、HSTS、安全响应头
- 备份不包含密钥类配置；会话持久化 + 删号/登出即时吊销

### 部署

- Go 1.26 + SQLite（modernc 最新），单二进制零依赖
- Docker / 一键 install.sh：非 root 运行、UMask=0077、数据文件 600、Caddy 自动 HTTPS

### 依赖

- storefront / admin-ui `npm audit` 均为 0 已知漏洞
