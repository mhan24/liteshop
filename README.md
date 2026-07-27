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

## 不再依赖 .env

从当前版本起，`.env` 不是必需的。

- 所有关键运行配置都可以在后台修改
- 后台配置保存在 SQLite `settings` 表，优先级高于环境变量
- 环境变量仍可作为首次引导或兼容方式使用
- 若未配置 `SHOP_ADMIN_PASSWORD`，首次启动且数据库中无管理员时，会生成一次性管理员密码并打印到日志
- Session Secret 未配置时会自动生成并持久化，重启不会失效

后台可配置的主要项：

| 模块 | 说明 |
| --- | --- |
| 站点设置 | 标题、副标题、公告、联系方式、友情链接、版权、隐私政策、服务条款、SEO、Turnstile |
| 支付设置 | BEpusdt Base URL、API Token、法币、收款类型、超时、公开地址、回调地址 |
| 通知设置 | SMTP、Telegram、邮件/Telegram 正文模板 |

## 技术栈

- Go 1.22+
- SQLite（纯 Go 驱动 `modernc.org/sqlite`，无需 CGO）
- 内嵌模板与静态资源，单二进制部署
- 无外部数据库依赖

## 快速开始（Docker Compose）

可选 `.env`：

```bash
cp .env.example .env   # 可选；也可启动后在后台修改配置
docker compose up --build
```

默认服务：

- 前台：http://localhost:8080
- 后台：http://localhost:8080/admin

## 本地开发

```bash
go run ./cmd/shop
```

如果不传任何环境变量且数据库为空，启动日志会输出一次性管理员密码；登录后请尽快在「账号设置」修改。

## 可选环境变量

环境变量仅为可选引导，后台配置优先级更高。

| 变量 | 说明 |
| --- | --- |
| `SHOP_LISTEN_ADDR` | 监听地址，默认 `:8080` |
| `SHOP_DATABASE_PATH` | SQLite 路径，默认 `data/shop.db` |
| `SHOP_PUBLIC_BASE_URL` | 前台对外地址，用于回跳 |
| `SHOP_ADMIN_USERNAME` | 初始管理员用户名，默认 `admin` |
| `SHOP_ADMIN_PASSWORD` | 初始管理员密码，留空则首次启动生成 |
| `SHOP_SESSION_SECRET` | Session 密钥，留空则自动生成并持久化 |
| `BEPUSDT_BASE_URL` | BEpusdt 地址 |
| `BEPUSDT_API_TOKEN` | BEpusdt 后台获取的 API Token |
| `BEPUSDT_NOTIFY_URL` | BEpusdt 异步回调地址 |
| `BEPUSDT_FIAT` | 法币，如 `CNY` |
| `BEPUSDT_TRADE_TYPES` | 多个收款类型，逗号分隔 |
| `TURNSTILE_SECRET` | Cloudflare Turnstile Secret Key |
| `TURNSTILE_SITE_KEY` | Cloudflare Turnstile Site Key |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM` | 邮件通知 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram 通知 |

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
internal/config/     配置（环境变量可选）
internal/db/         SQLite 迁移与设置读写
internal/models/     模型与工具函数
internal/bepusdt/    BEpusdt 签名与交易创建/回调验签
internal/notify/     邮件/Telegram 通知与模板
internal/web/        HTTP 路由、后台/前台页面、静态资源
```

## 许可证

MIT，见 [LICENSE](LICENSE)。
