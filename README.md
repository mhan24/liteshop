# LiteShop

基于 Go + SQLite 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。
买家前台使用 Nuxt 3 SSR + Tailwind，管理后台使用 Vue 3 + TypeScript + Element Plus + Pinia。

> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 遵循 GPL-3.0，本项目采用 MIT 协议。

## 架构

```
用户请求
  │
  ├─ Caddy 分流
  │   ├─ /api, /notify, /admin, /health  → Go API 服务
  │   └─ /*                              → Nuxt 3 SSR (Node)
  │
  Go (单体二进制)
  ├─ JSON API (/api/v1/*)
  ├─ BEpusdt 回调 (/notify/bepusdt)
  └─ Element Plus 后台静态资源 (/admin)

  Nuxt 3 SSR (独立 Node 进程)
  └─ 买家前台 / 订单查询 / 隐私条款 / SEO
```

## 功能

### 前台 (Nuxt 3 SSR)

- 商品列表（分类/置顶/排序）
- 商品详情 + Cloudflare Turnstile
- 订单查询（支持仅邮箱找回最近订单）
- SEO：meta/canonical/OG/JSON-LD/sitemap/robots/favicon

### 后台 (Element Plus + Pinia)

- 仪表盘：商品/卡密/订单统计
- 商品：新建/编辑/分类/置顶/排序/价格/上下架
- 卡密：导入/删除
- 订单：查看/标记过期/重发通知/CSV 导出
- 支付：BEpusdt Base URL/API Token/收款类型/超时/公开地址/回调地址
- 通知：SMTP/Telegram/邮件模板
- 站点：标题/公告/SEO/联系方式/友情链接/版权/隐私/条款/Turnstile
- 账号：改用户名/改密码
- 系统：配置备份/恢复/清空数据并重新初始化

### 后端 (Go)

- SQLite 存储（纯 Go，无需 CGO）
- API 限流（下单 20次/分，登录 10次/分）
- 安全头（X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy）
- 健康检查 `/health`
- 首次初始化 `/setup`

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前台 | Nuxt 3 SSR + Tailwind CSS |
| 后台 | Vue 3 + Vite + TypeScript + Element Plus + Pinia |
| 后端 | Go 1.22+ |
| 数据库 | SQLite (modernc.org/sqlite，纯 Go) |
| 反向代理 | Caddy |
| 支付 | BEpusdt |

## 目录结构

```
cmd/shop/            Go 程序入口
internal/config/     配置
internal/db/         SQLite 迁移与设置读写
internal/models/     模型与工具
internal/bepusdt/    BEpusdt 签名与交易/回调
internal/notify/     邮件/Telegram 通知
internal/web/        HTTP 路由、JSON API、后台静态资源嵌入
admin-ui/            Element Plus 后台（TS + Pinia）
storefront/          Nuxt 3 SSR 前台（Tailwind）
```

## 开发

### 前置要求

- Go 1.22+
- Node.js 18+ / npm
- BEpusdt 实例

### 本地开发

后端（端口 8080）：

```bash
go run ./cmd/shop
```

后台（端口 5174）：

```bash
cd admin-ui
npm install
npm run dev
```

前台（端口 3001）：

```bash
cd storefront
npm install
npm run dev
```

### 构建

```bash
# 后台静态资源 → internal/web/admin-ui
cd admin-ui && npm install && npm run build && cd ..

# 前台 SSR 产物 → storefront/.output
cd storefront && npm install && npm run build && cd ..

# Go 单体二进制（内嵌后台静态资源）
go build -o shop ./cmd/shop
./shop
```

### 部署

见 `docker-compose.yml`（建议改成多服务架构：Caddy + Go + Nuxt SSR）。

生产部署示例见 systemd 单元：
- `cardshop.service` → Go
- `liteshop-storefront.service` → Nuxt SSR

## 首次初始化

启动后访问 `/setup`，设置管理员账号和基础信息，然后登录 `/admin/login`。

## 后台配置

所有配置保存在 SQLite `settings` 表，后台修改立即生效，不依赖 `.env`。

## BEpusdt 对接

- 在 BEpusdt 后台获取 API Token
- 创建订单后跳转 BEpusdt 收银台
- 支付成功后回调 `/notify/bepusdt`
- 签名规则：参数排序拼接 + API Token 后做 MD5，空值/null 不参与

## Cloudflare Turnstile

- 前台下单页嵌入 Turnstile
- 后端 `POST /api/v1/orders` 调用 canonical siteverify
- 只有 `success === true` 才继续创建订单

## 许可证

MIT，见 [LICENSE](LICENSE)。
