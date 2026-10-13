# liteshop

轻量数字商品（卡密）售卖站：前台展示商品 + 游客购买，后台管理商品/卡密/订单，支持**自动卡密发货**与**手动录入人工发货**，收单对接 [bepusdt](https://github.com/v03413/bepusdt)（USDT / 多链加密货币支付网关）。

> 设计与实现计划见 [PLAN.md](./PLAN.md)。

## 功能

**前台（游客模式，无需注册）**
- 商品列表 / 详情，下单跳转收银台（USDT 等加密货币支付）
- 支付回跳页实时轮询订单状态
- 订单查询：订单号 + 邮箱双因子，查看卡密 / 交付内容

**后台（`/admin`）**
- 仪表盘：订单、销售额、待处理、卡密余量预警
- 商品管理：自动发卡 / 人工发货两种类型，上下架
- 卡密管理：批量导入（一行一个；允许重复内容，故**不加**唯一约束）、余量/已售追踪
- 订单管理：人工发货、重试自动发货、关闭订单（全操作审计日志）
- 系统设置：站点信息、bepusdt 渠道配置（API 地址 / Token / 超时）、人机验证、邮件通知、前台文案

## 技术栈

Next.js（App Router）+ TypeScript + Tailwind CSS + shadcn/ui · Drizzle ORM + SQLite（WAL）· Docker 部署。
UI 遵循 [taste-skill · minimalist-ui](https://github.com/Leonxlnx/taste-skill) 极简编辑风（规范存于 `skills/minimalist-ui/`）。

## Docker 部署（推荐）

```bash
git clone <repo> liteshop && cd liteshop
npm ci
cp .env.example .env

# 生成会话密钥
openssl rand -hex 32   # 填入 .env 的 AUTH_SECRET

# 生成管理员密码哈希（需要本地 Node 20+，或在容器内执行）
npm run hash-password -- <你的密码>   # 输出填入 .env 的 ADMIN_PASSWORD_HASH

docker compose up -d --build
```

Compose 默认仅绑定服务器回环地址。服务器本机可访问 `http://127.0.0.1:3000`（前台）和 `/admin`（后台）；远程调试使用 SSH 端口转发。对外访问应按 [运维手册](./docs/OPERATIONS.md) 配置 Caddy 与 HTTPS。

生产必须通过反向代理（Nginx / Caddy）提供 **HTTPS**：会话 Cookie 依赖 `Secure`，支付回调也要求公网可达。

### 发布流程

代码改动与上线**分离**：

```bash
# 1) 只提交代码（不改动生产）
npm test && npx tsc --noEmit && npm run lint
git push

# 2) 确认要上线时，再执行部署（脚本会同步源码并重建容器）
./scripts/deploy.sh --dry-run   # 预览将要同步的文件
./scripts/deploy.sh             # 交互确认后部署；CI 等自动化场景用 --yes
```

部署脚本会：
- 只同步源码（`node_modules`/`.next`/`data`/`.env*` 一律排除）
- 解包前后比对 `.env` 指纹，**防止覆盖生产配置**（不一致即中止）
- 重建镜像并重启，随后由健康检查判定结果

凭证放在 `.deploy.env`（参考 `.deploy.env.example`，勿入库）。

### docker-compose 要点

- 数据卷 `liteshop-data` 挂载 `/app/data`：SQLite 数据库 + 自动备份目录
- 健康检查：`GET /api/health`（含 DB 只读探测）
- **SQLite 单写者：禁止水平扩容（副本数必须为 1）**
- 迁移在应用启动时自动应用（`drizzle/` 目录，全部 additive）

## 对接 bepusdt

1. 部署 bepusdt（官方 Docker 方式，见其仓库 README），进入其管理后台
2. 后台 → 系统管理 → 基本设置 → API 设置 → **对接令牌**：复制 Token
3. liteshop 后台 → 设置 → 支付渠道 · bepusdt：
   - API 地址：bepusdt 服务地址（如 `https://pay.example.com`）
   - 对接令牌：上一步复制的 Token
   - 订单超时：180–3600 秒（越界网关会忽略并改用其默认值）
   - 勾选「启用」并保存
   > 不传 `trade_type`：由 bepusdt 收银台让买家自选币种与网络。
4. 回调地址自动构造为 `https://你的站点/api/pay/notify/bepusdt`，无需在 bepusdt 侧手工登记

> 开发/演示可设 `PAYMENT_DRIVER=mock`：出现本地模拟收银台（`/pay/mock`），一键模拟支付成功/超时，走真实回调链路。

## 首次使用

1. 登录 `/admin`（账号 `.env` 中的 `ADMIN_USER`）
2. 设置 → 填写站点名称、站点地址（`https://你的域名`）、配置支付渠道
3. 商品 → 新建商品（选「自动发卡」或「人工发货」）并上架
4. 卡密 → 选中商品 → 批量导入（一行一个）
5. 前台下单测试：查单页凭「订单号 + 邮箱」取货

## 运维

```bash
npm test                    # 单测（签名/验签、回调幂等、并发领卡、金额解析）
npm run backup              # 在线一致性备份（SQLite VACUUM INTO → data/backups/）
npm run hash-password -- x  # 生成密码哈希（写入 .env 后重启生效；同时使全部旧会话失效）
                            # 格式 scrypt:N:r:p:salt:hash——切勿用 $ 作分隔符，
                            # Docker Compose 加载 env_file 时会插值 $var 导致哈希损坏
```

**运行时说明**：Dockerfile 锁定 `node:22.23-bookworm-slim`（Debian glibc）。两个原因：① Turbopack 在 Alpine/musl 的 ARM 上会 SIGSEGV；② 部分 ARM 主机（如 Oracle Neoverse-N1）上 Node 20 的原生 SQLite 调用会段错误，Node 22/24 正常。升级基础镜像时保持 `npm ci && npm rebuild better-sqlite3` 步骤（Dockerfile 已包含）；本地升级 Node 后执行 `rm -rf node_modules && npm ci`。

## 目录速览

```
src/
├── app/            # (shop) 前台 · admin 后台 · api 回调与健康检查
├── server/         # 业务服务层：order / delivery / payment / auth / admin
├── actions/        # Server Actions（登录、下单、后台 CRUD）
├── components/     # shadcn/ui（按 minimalist-ui 定制）
├── db/             # Drizzle schema + 迁移
└── lib/            # 金额(BigInt 分)、签名、会话、订单号
drizzle/            # 迁移 SQL（启动时自动应用）
skills/             # taste-skill · minimalist-ui 规范
```

## 许可

仅供学习研究使用。
