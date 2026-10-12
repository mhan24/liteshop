# 部署与验收记录

按时间倒序。用于故障排查与版本回滚。

---

## 2026-10-12 · `f6350cd`（当前生产）

**状态**：已上线并通过验收（版本对齐部署）

### 提交

| 项 | 值 |
|---|---|
| SHA | `f6350cda36667b60fd902657a85bf4ad97e7f295` |
| 短 SHA | `f6350cd` |
| 消息 | `docs: 记录部署后稳定性排查的三个问题与恢复演练结果` |
| 部署时间 | 2026-10-12T19:23+08:00 |
| 上一版本 | `8f9ab2c1f15c7a03ac6801bc00caee5d7efe74eb`（已记入 `previous`） |

### 本次对齐的提交

| SHA | 内容 |
|---|---|
| `f6350cd` | 部署记录文档 |
| `e3752af` | 构建期不打开数据库、单例全环境缓存 |
| `f3fcce4` | **运维脚本纳入仓库** + 运维手册 + 部署记录 |

### 数据库

| 项 | 值 |
|---|---|
| 迁移数 | 7（本次无新增迁移） |
| integrity_check | ok |
| foreign_key_check | ok |
| 数据 | orders 5 / products 1 / cards 2 / payment_attempts 5 / payment_anomalies 0 |

### 部署前备份

- `pre-f6350cd-20261012-192311.db`（196K，VACUUM INTO）
- `env-pre-f6350cd-20261012-192311.bak`

### 验收项目

| 项目 | 结果 |
|---|---|
| 容器健康 | 应用 healthy、Caddy healthy（`--wait` 门控） |
| **运维脚本自检** | ✅「运维脚本就位」「定时任务指向的脚本均存在」 |
| **cron 脚本存活** | ✅ `scripts/ops/*.sh` 部署后仍在，逐个执行验证通过 |
| 站点 | `/` `/orders` `/products/voxi` `/admin/login` 全 200 |
| 安全响应头 | 3/3（CSP / HSTS / Permissions-Policy） |
| mock 回调入口 | 404 |
| cron 端点 | 正常 |
| **真实网关建单** | ✅ `expiration_time=899` |
| **冷启动** | ✅ 停容器后重启，健康通过 |
| **服务器 vs git** | ✅ 139 个文件逐文件 sha256 完全一致 |
| 目录卫生 | 0 个 AppleDouble，`.env` 保留 |
| 发布记录 | `current=f6350cd`、`previous=8f9ab2c` |

### 回滚方式

```bash
git checkout 8f9ab2c1f15c7a03ac6801bc00caee5d7efe74eb
./scripts/deploy.sh
```

---

## 2026-10-12 · `8f9ab2c`（当前生产）

**状态**：已上线并通过验收

### 提交

| 项 | 值 |
|---|---|
| SHA | `8f9ab2c1f15c7a03ac6801bc00caee5d7efe74eb` |
| 短 SHA | `8f9ab2c` |
| 消息 | `test: 修复限流窗口过期用例的时钟依赖（CI flaky）` |
| 部署时间 | 2026-10-12T16:56:10+08:00 |
| CI | ✅ success（14 步全通过，含无密钥 Docker 构建） |
| 上一版本 | `unknown`（首次使用外部发布记录） |

### 数据库

| 项 | 值 |
|---|---|
| 迁移数 | 7（本次新增 `0006_payment_anomalies`） |
| 新增表 | `payment_anomalies`（13 列） |
| integrity_check | ok |
| foreign_key_check | ok |
| 数据 | orders 5 / products 1 / cards 2 / payment_attempts 5 |

### 部署前备份

- `pre-8f9ab2c-20261012-165402.db`（176K，VACUUM INTO）
- `env-pre-8f9ab2c-20261012-165402.bak`

### 验收项目

| 项目 | 结果 |
|---|---|
| 容器健康 | `liteshop-liteshop-1` healthy、`liteshop-caddy-1` healthy（`--wait` 门控） |
| 站点 | `/` `/orders` `/products/voxi` `/admin/login` 全 200 |
| 健康检查 | `{"ok":true}` |
| 安全响应头 | CSP / HSTS / Permissions-Policy 均在 |
| mock 回调入口 | 404（防护保持关闭） |
| cron 端点 | 正常，含邮件重试与日志清理 |
| **真实网关建单** | ✅ `expiration_time=899`（正确换算，非 1970） |
| **冷启动** | ✅ 停容器后重启，健康检查通过 |
| **服务器 vs git** | ✅ 136 个文件逐文件 sha256 完全一致 |
| 目录卫生 | 0 个 AppleDouble 文件 |
| 发布记录 | 写入 `/var/lib/liteshop-release/`（目标目录之外） |

### 本次暴露并修复的运维缺陷

1. **`expire-cron.sh` / `backup-cron.sh` 被部署删除**
   - 原因：脚本手工放在 `/opt/liteshop/` 根下且未入库，
     `rsync --delete` 让目标目录严格等于提交内容 → 脚本被删
   - 后果：**超时清扫与每日备份同时静默失效**
   - 修复：脚本纳入仓库 `scripts/ops/`，新增 `install-cron.sh`，
     部署后自检脚本存在性与 crontab 指向有效
2. **`deploy.sh` 变量名后被全角字符吞并**（3 处）
   - `$DEPLOY_SHA（` 被 bash 解析为变量名 `DEPLOY_SHA（` → unbound variable
   - 修复：统一 `${VAR}` 形式，并加 shellcheck 检查

### 遗留观察

- `liteshop-deps:latest`（2.14GB）：Dockerfile 多阶段构建的中间层缓存，
  保留可加速构建，非垃圾
- 磁盘使用 56%

### 部署后的稳定性排查（同一维护窗口，未再部署）

对生产做稳定性巡检时发现并修复了三个问题。**其中两个已在生产即时处置**
（不涉及代码发布的运维修复），第三个属代码缺陷、已推送 GitHub 待授权部署。

#### 1. 定时任务脚本被部署删除（严重，已即时修复）

| 项 | 内容 |
|---|---|
| 现象 | `/opt/liteshop/expire-cron.sh` 与 `backup-cron.sh` 不存在 |
| 后果 | **超时订单清扫与每日自动备份同时静默失效** |
| 根因 | 脚本手工放在 `/opt/liteshop/` 根下且未入库，`rsync --delete` 将其删除 |
| 修复 | 脚本纳入 `scripts/ops/`；生产已重新安装 crontab 并验证 |

恢复后验证：清扫 ✓、备份 ✓（`daily/liteshop-20261012-183625.db`，200K）。

#### 2. 备份恢复演练（新 schema，已验证）

| 项目 | 结果 |
|---|---|
| 备份 | `daily/liteshop-20261012-183625.db` |
| integrity / foreign_key | 均 ok |
| 表完整性 | 9 张关键表齐全，迁移数 7 |
| 恢复后启动 | health ok，`/` `/products/voxi` `/orders` `/admin/login` 全 200 |
| 写能力 | 可建表删表，WAL 可切换 |

**演练踩坑（重要）**：数据目录须 `chown -R 999:999`。生产容器用户是
**uid 999**（`liteshop`），误用 `100:101` 会导致
`SqliteError: attempt to write a readonly database`（无法创建 WAL 文件）。
这不是备份损坏。

#### 3. 构建期打开数据库 + 单例未在生产缓存（代码缺陷，待部署）

CI 的「无密钥 Docker 构建」失败，暴露出：

- `next build` 收集页面数据时会 `openDb + runMigrations + ensureSeed`，
  并发 worker 各自迁移同一库 → `table admin_logs already exists`
- 单例缓存写成 `if (NODE_ENV !== "production")`，生产路径每次模块求值
  都重新 `createDb()`，加剧上述竞争

修复（`e3752af`）：构建期返回惰性 Proxy 占位（误用即抛错），完全不建立连接；
单例改为所有环境缓存。

验证：
- 生产构建在**只读 DATA_DIR** 下成功 → 证明不再触碰数据库
- 新镜像 + 全新空卷：health ok、页面全 200、自动应用 7 个迁移 → 运行期无回归
- 服务器实测无密钥 docker build 成功

---

## 历史提交（本次审查周期内）

| SHA | 说明 |
|---|---|
| `e3752af` | 构建期不打开数据库、单例全环境缓存（待部署） |
| `f3fcce4` | 恢复被部署删除的定时任务；新增运维手册与部署记录 |
| `eae5907` | 异常到账先校验后登记、人工商品补发流程 |
| `062b9ff` | 超时后到账人工对账出口 + CI 无密钥构建 |
| `f229cab` | Turnstile 重复验证、对账恢复闭环、Docker 密钥隔离、部署一致性 |
| `2f06261` | 改用 git archive，修复 AppleDouble 垃圾文件 |
| `9e2580b` | 统一下单入口防护、支付结果分类、待对账状态 |
| `2cdf30d` | 回调应答语义、JPY 入账、过期重新购买、并发支付 |

---

## 恢复演练记录

### 2026-10-12 · 在 `8f9ab2c` schema（7 迁移）上验证

| 项目 | 结果 |
|---|---|
| 备份文件 | `daily/liteshop-20261012-183625.db`（200K） |
| integrity_check | ok |
| foreign_key_check | ok |
| 表完整性 | 9 张关键表全部存在，迁移数 7 |
| 恢复到隔离卷并启动 | ✅ health ok、`/` `/products/voxi` `/orders` `/admin/login` 全 200 |
| 写能力 | ✅ 可建表/删表，WAL 可切换 |

**演练中踩到的坑（已记入运维手册）**：
初次演练给数据目录 `chown 100:101`，应用报
`SqliteError: attempt to write a readonly database`。
实际容器用户是 **uid 999**（`liteshop`），改为 `chown -R 999:999` 后完全正常。
这不是备份问题，是权限配置问题。

---

## 记录规范

每次部署后追加一节，至少包含：

1. 提交 SHA、部署时间、CI 结果
2. 迁移数量与新增表
3. 部署前备份文件名
4. 验收结果（站点、健康、真实网关、冷启动、服务器与 git 一致性）
5. 本次暴露的问题与修复
