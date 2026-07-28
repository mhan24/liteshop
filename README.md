# LiteShop

基于 Go + SQLite 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。
前端使用 Vue 3 + Ant Design Vue，后端提供 JSON API，支付成功后自动发卡。

> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 本身遵循 GPL-3.0，本项目采用 MIT 协议。

## 功能概览

- 前端：Vue 3 + Vue Router + Ant Design Vue，响应式布局
- 后端：Go 单体服务，SQLite 存储，JSON API
- 商品：分类、置顶、排序、库存（卡密）管理
- 支付：BEpusdt 创建交易 + 异步回调验签自动发卡
- 通知：邮件 SMTP / Telegram，后台可自定义模板
- 安全：前台下单接入 Cloudflare Turnstile
- 后台：商品、卡密、订单、支付、通知、站点、账号、系统设置
- 首次部署初始化页 `/setup`
- 配置备份 / 恢复
- 不依赖 `.env`，所有配置都可在后台修改

## 技术栈

- Go 1.22+
- SQLite（纯 Go 驱动 `modernc.org/sqlite`，无需 CGO）
- Vue 3 + Vite + Ant Design Vue 4
- 内嵌 SPA 构建产物，最终只需一个 Go 二进制

## 目录结构

```text
cmd/shop/            Go 程序入口
internal/config/     配置
internal/db/         SQLite 迁移与设置读写
internal/models/     模型与工具
internal/bepusdt/    BEpusdt 签名与交易/回调
internal/notify/     邮件/Telegram 通知
internal/web/        HTTP 路由、JSON API、SPA 嵌入
frontend/            Vue + AntDV 前端工程
```

## 开发

### 前置要求

- Go 1.22+
- Node.js 18+ / npm
- BEpusdt 实例（用于支付）

### 本地开发

后端：

```bash
go run ./cmd/shop
```

前端（开发服务器，默认代理 `/api` 到 `http://127.0.0.1:8080`）：

```bash
cd frontend
npm install
npm run dev
```

### 构建生产产物

```bash
cd frontend
npm install
npm run build      # 产物输出到 internal/web/spa
cd ..
go build -o shop ./cmd/shop
./shop
```

## Docker

```bash
docker build -t liteshop .
docker run -d -p 8080:8080 -v liteshop_data:/app/data liteshop
```

Dockerfile 已包含前端构建阶段，无需本地安装 Node。

## 首次初始化

启动后访问：

```text
/setup
```

设置管理员账号、站点标题及可选的 BEpusdt / Turnstile 配置，完成后用设置的用户名密码登录后台。

## 后台

```text
/admin
```

可配置：

- 站点：标题、公告、SEO、联系方式、友情链接、版权、隐私政策、服务条款、Turnstile
- 支付：BEpusdt Base URL、API Token、收款类型、超时、公开地址、回调地址
- 通知：SMTP、Telegram、邮件/Telegram 模板
- 商品：分类、置顶、排序、价格、卡密导入
- 订单：查看、标记过期、重发通知
- 系统：配置备份/恢复、清空数据并重新初始化

所有后台配置保存在 SQLite `settings` 表，优先级高于环境变量。

## BEpusdt 对接要点

- 在 BEpusdt 后台获取 API Token
- 创建订单后跳转 BEpusdt 收银台
- 支付成功后回调 `/notify/bepusdt`
- 签名规则：参数排序拼接 + API Token 后做 MD5，空值/null 不参与
- 回调成功返回 HTTP 200 和 `ok`

## Cloudflare Turnstile

- 前台下单页嵌入 Turnstile
- 后端 `POST /api/v1/orders` 调用 canonical siteverify
- 只有 `success === true` 才继续创建订单

## 可选环境变量

环境变量仅用于首次引导，后台配置优先级更高。

| 变量 | 说明 |
| --- | --- |
| `SHOP_LISTEN_ADDR` | 监听地址，默认 `:8080` |
| `SHOP_DATABASE_PATH` | SQLite 路径，默认 `data/shop.db` |
| `SHOP_ADMIN_USERNAME` | 初始管理员用户名 |
| `SHOP_ADMIN_PASSWORD` | 初始管理员密码；留空则进入 `/setup` |
| `BEPUSDT_BASE_URL` | BEpusdt 地址 |
| `BEPUSDT_API_TOKEN` | BEpusdt API Token |
| `TURNSTILE_SECRET` | Turnstile Secret |
| `TURNSTILE_SITE_KEY` | Turnstile Site Key |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USERNAME` / `SMTP_PASSWORD` / `SMTP_FROM` | 邮件通知 |
| `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` | Telegram 通知 |

## 许可证

MIT，见 [LICENSE](LICENSE)。
