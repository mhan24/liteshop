# LiteShop

基于 Go + SQLite 的自动发卡系统，对接 [BEpusdt](https://github.com/v03413/BEpusdt) 加密货币收单网关。
买家前台使用 Nuxt 3 SSR + Tailwind，管理后台使用 Vue 3 + TypeScript + Element Plus + Pinia，Go 提供 JSON API 与支付回调。

> 本项目与 BEpusdt 作者无隶属关系。BEpusdt 遵循 GPL-3.0，本项目采用 MIT 协议。

## 架构

```
用户浏览器
    │
    ▼
Cloudflare (CDN/HTTPS)
    │
    ▼
Caddy (反向代理 :443)
    ├── /api, /notify, /admin, /health  → Go :8080
    └── /*                               → Nuxt SSR :3001
```

| 进程 | 技术 | 端口 |
| --- | --- | --- |
| Go API | Go 1.22 + SQLite (modernc) | 8080 |
| 前台 SSR | Nuxt 3 + Tailwind | 3001 |
| 后台 SPA | Vue 3 + TS + Element Plus + Pinia | 内嵌进 Go |

## 功能

### 前台（Nuxt 3 SSR）

- 商品列表（分类 / 置顶 / 排序）
- 商品详情 + Cloudflare Turnstile
- 下单：新标签页打开 BEpusdt 收银台，当前页跳订单详情页
- 订单详情：待支付自动轮询、支付成功自动显示卡密、支持取消订单（同步关闭 BEpusdt 交易）
- 订单查询：支持仅邮箱找回最近订单
- 隐私 / 服务条款 / 首次初始化 `/setup`
- SEO：canonical / OG / JSON-LD / sitemap / robots / favicon

### 后台（Element Plus + Pinia）

- 仪表盘：商品 / 卡密 / 订单统计
- 商品：新建 / 编辑 / 分类 / 置顶 / 排序 / 价格 / 上下架
- 卡密：导入 / 删除
- 订单：查看 / CSV 导出 / 标记过期 / 重发通知
- 支付：BEpusdt Base URL / API Token / 收款类型 / 超时 / 公开地址 / 回调地址
- 通知：SMTP / Telegram / 邮件模板（支持占位符）
- 站点：标题 / 公告 / SEO / 链接编辑（名称 + 链接 + 分类）/ 版权 / 隐私 / 条款 / Turnstile
- 维护模式：开关 + 通知文案 + 解锁密码
- 账号：改用户名 / 改密码
- 系统：配置备份 / 恢复 / 清空数据并重新初始化

### 后端（Go）

- SQLite 存储（纯 Go，无需 CGO），所有配置存 `settings` 表，无 `.env`
- BEpusdt 对接：创建交易、取消交易、回调验签（MD5）
- API 限流（下单 20/分，登录 10/分）
- 安全头（X-Frame-Options / nosniff / Referrer-Policy / Permissions-Policy）
- 健康检查 `/health`
- 首次初始化 `/setup`

## 支付流程

```
下单 → 锁定卡密 → 创建 BEpusdt 交易 → 新标签页打开收银台
  → 原页跳订单详情页（自动轮询）
  → 用户转账 → BEpusdt 回调 /notify/bepusdt → 验签 → 订单 paid
  → 卡密 sold → 邮件/Telegram 通知 → 前台自动显示卡密
```

取消 / 过期：释放库存 + 同步调用 BEpusdt `cancel-transaction` 关闭交易。

## 技术栈

| 层 | 技术 |
| --- | --- |
| 前台 | Nuxt 3 SSR + Tailwind CSS |
| 后台 | Vue 3 + Vite + TypeScript + Element Plus + Pinia |
| 后端 | Go 1.22+ |
| 数据库 | SQLite (modernc.org/sqlite) |
| 反向代理 | Caddy |
| 支付 | BEpusdt |
| 安全 | Cloudflare Turnstile |

## 目录结构

```
cmd/shop/            Go 程序入口
internal/config/     配置（纯默认值）
internal/db/         SQLite 迁移与设置读写
internal/models/     模型与工具
internal/bepusdt/    BEpusdt 创建/取消交易、签名、回调验签
internal/notify/     邮件 / Telegram 通知与模板
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

后端（8080）：

```bash
go run ./cmd/shop
```

后台（5174）：

```bash
cd admin-ui && npm install && npm run dev
```

前台（3001）：

```bash
cd storefront && npm install && npm run dev
```

### 构建

```bash
# 后台静态资源 → internal/web/admin-ui
cd admin-ui && npm install && npm run build && cd ..

# 前台 SSR 产物 → storefront/.output
cd storefront && npm install && npm run build && cd ..

# Go 单体二进制（内嵌后台）
go build -o shop ./cmd/shop
./shop
```

> `internal/web/admin-ui` 是后台构建产物，已被 `.gitignore` 忽略，不提交到仓库。

## 部署（服务器）

- Go：systemd `cardshop`，运行 `/opt/cardshop/shop`，监听 8080
- 前台：systemd `liteshop-storefront`，运行 `/opt/liteshop-storefront/server/index.mjs`，监听 3001
- Caddy：按路径分流 API/后台/回调 到 Go，其余到 Nuxt
- 部署脚本：`/usr/local/bin/deploy-storefront.sh`（自动复制 public 静态资源）
- 源码：`/opt/liteshop-src`

## 测试与 CI

- Go 单元测试：`go test ./...`（覆盖 BEpusdt 签名/回调验签、价格换算、订单号、密码哈希）
- CI（`.github/workflows/ci.yml`）：push/PR 到 main 自动跑
  - Go `vet` / `build` / `test`，并产出 linux-arm64 二进制 artifact
  - 后台 `npm ci && npm run build`
  - 前台 `npm ci && npm run build`

## 缓存与 SEO

Caddy 缓存头策略：

| 路径 | Cache-Control |
| --- | --- |
| `/_nuxt/*`、`/assets/*`、`/admin/assets/*` | `public, max-age=31536000, immutable` |
| `/robots.txt`、`/sitemap.xml` | `public, max-age=3600` |
| `/favicon.svg` | `public, max-age=86400` |
| `/api/*`、`/admin/*`、`/order*`、`/setup`、`/health` | `no-store` + `X-Robots-Tag: noindex` |

- HTML 页面默认不缓存（SSR 动态内容），由 Nuxt 输出 canonical / OG / JSON-LD。
- `robots.txt` 会输出 `Sitemap:` 指向 `sitemap.xml`；`sitemap.xml` 动态包含商品 URL。
- 安全头统一由 Caddy 输出：`X-Content-Type-Options` / `X-Frame-Options` / `Referrer-Policy` / `Permissions-Policy`。

> **Cloudflare 提示**：若你开启了 Cloudflare 的 "Managed robots.txt"，它会在代理层合并/覆盖 `robots.txt` 并可能剥离 origin 的缓存头。如需完全由本服务输出，请在 Cloudflare 面板 → Bots / Scrape Shield 中关闭该功能，并确保 CDN 不缓存 `/admin`、`/api`、`/order*`、`/setup`。

## BEpusdt 对接

- 在 BEpusdt 后台获取 API Token
- 创建交易后跳转收银台；取消 / 过期调用 `cancel-transaction`
- 支付成功回调 `/notify/bepusdt`
- 签名：参数排序拼接 + API Token 后 MD5，空值/null 不参与

## Cloudflare Turnstile

- 前台下单页嵌入 Turnstile
- 后端 `POST /api/v1/orders` 调用 canonical siteverify
- 只有 `success === true` 才继续创建订单

## 许可证

MIT，见 [LICENSE](LICENSE)。
