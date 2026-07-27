# LiteShop

基于 Go + SQLite 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。
支付成功后自动发卡，支持邮件 / Telegram 通知、Cloudflare Turnstile 防机器人、后台可配置站点/支付/通知/模板。

> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 本身遵循 GPL-3.0，本项目采用 MIT 协议。

## 功能概览

- 前台：商品列表、分类/置顶/排序、下单、独立订单查询页
- 支付：BEpusdt `create-transaction` + 异步回调验签自动发卡
- 通知：邮件（SMTP）和 Telegram，后台可自定义模板与占位符
- 安全：下单表单接入 Cloudflare Turnstile，服务端 canonical siteverify
- 后台：商品/卡密/订单、站点设置、支付设置、通知设置、账号设置
- SEO：可配置标题/副标题/公告/描述/关键词，输出 canonical/OG/robots
- 部署：单体二进制，支持 Docker Compose 或 systemd + Caddy/Nginx

## 技术栈

- Go 1.22+
- SQLite（纯 Go 驱动 `modernc.org/sqlite`，无需 CGO）
- 内嵌模板与静态资源，单二进制部署
- 无外部数据库依赖

## 快速开始（Docker Compose）

```bash
cp .env.example .env
# 按需修改 .env：SHOP_ADMIN_PASSWORD、SHOP_SESSION_SECRET、BEPUSDT_API_TOKEN 等
docker compose up --build
```

默认服务：

- 前台：http://localhost:8080
- 后台：http://localhost:8080/admin

## 本地开发

```bash
cp .env.example .env
go run ./cmd/shop
```

常用调试命令见 `cmd/shop/main.go`，配置项见 `.env.example`。

## 主要环境变量

| 变量 | 说明 |
| --- | --- |
| `SHOP_LISTEN_ADDR` | 监听地址，默认 `:8080` |
| `SHOP_DATABASE_PATH` | SQLite 路径，默认 `data/shop.db` |
| `SHOP_PUBLIC_BASE_URL` | 前台对外地址，用于回跳 |
| `BEPUSDT_BASE_URL` | BEpusdt 地址 |
| `BEPUSDT_API_TOKEN` | BEpusdt 后台获取的 API Token |
| `BEPUSDT_NOTIFY_URL` | BEpusdt 异步回调地址 |
| `BEPUSDT_FIAT` | 法币，如 `CNY` |
| `BEPUSDT_TRADE_TYPES` | 多个收款类型，逗号分隔 |
| `TURNSTILE_SECRET` | Cloudflare Turnstile Secret Key |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile Site Key |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM` | 邮件通知 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram 通知 |

注意：多数支付/通知/站点设置也可以登录后台修改，后台设置优先级高于 `.env`。

## BEpusdt 对接要点

- 在 BEpusdt 后台获取 API Token
- 发卡系统创建订单后会跳转到 BEpusdt 收银台
- BEpusdt 支付成功后回调 `/notify/bepusdt`
- 回调签名按 BEpusdt 规则：参数排序拼接 + API Token 后做 MD5，空值/null 不参与签名
- 回调成功需返回 HTTP 200 和 `ok`

## Cloudflare Turnstile

- 前台下单页嵌入 Turnstile widget
- 后端在 `POST /orders` 内调用 canonical siteverify：
  - `POST https://challenges.cloudflare.com/turnstile/v0/siteverify`
  - `secret=TURNSTILE_SECRET`、`response=cf-turnstile-response`、`remoteip=客户端 IP`
- 只有 `success === true` 才继续创建订单；失败时在商品页内提示，不跳裸 forbidden

## 项目结构

```text
cmd/shop/            程序入口
internal/config/     配置与 .env 加载
internal/db/         SQLite 迁移与设置读写
internal/models/     模型与工具函数
internal/bepusdt/    BEpusdt 签名与交易创建/回调验签
internal/notify/     邮件/Telegram 通知与模板
internal/web/        HTTP 路由、后台/前台页面、静态资源
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
