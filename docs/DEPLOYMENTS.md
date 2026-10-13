# 部署与验收记录

按时间倒序。用于故障排查与版本回滚。

---

## 2026-10-13 · `e1d1c5e`（当前生产）

**状态**：已上线并通过验收（审计完全通过后发布）

### 提交

| 项 | 值 |
|---|---|
| SHA | `e1d1c5e10579b0d01d47241e215d33435c932a67` |
| 短 SHA | `e1d1c5e` |
| 部署时间 | 2026-10-13T12:08+08:00 |
| 上一版本 | `92a607b4aca8bb698b584f1b02d3a969d68cbd44` |
| CI | ✅ success |
| 新迁移 | **无**（仍为 9） |

### 本次追赶的提交

| SHA | 内容 |
|---|---|
| `19ff248` | 部署记录（文档） |
| `8df87d3` | 库存模式切换守卫、网关异常分类、回调日志不落库、限流容量 |
| `0c979b2` | 限流批量淘汰、网关 408/429 分类、重试路径真实测试 |
| `96d10ab` | 网关响应 null/标量/数组按 unknown、错误分类加固 |
| `e1d1c5e` | 关键字段类型校验（防库存滞留） |

### 数据库

| 项 | 值 |
|---|---|
| 迁移数 | 9（与部署前一致，无新迁移） |
| integrity_check | ok |
| foreign_key_check | ok |
| 数据 | orders 5 / products 1 / cards 2 / payment_attempts 5 / payment_anomalies 0 |

### 部署前备份

- `pre-e1d1c5e-20261013-120841.db`（216K，VACUUM INTO）
- `env-pre-e1d1c5e-20261013-120841.bak`

### 验收项目

| 项目 | 结果 |
|---|---|
| 容器健康 | 应用 + Caddy 双 healthy（`--wait` 门控） |
| 部署自检 | ✅ 运维脚本就位、cron 指向有效 |
| 数据完整性 | integrity ok / foreign_key ok |
| 数据量 | 与部署前完全一致 |
| **服务器 vs git** | ✅ **156 个文件逐文件 sha256 完全一致** |
| 站点 | `/` `/orders` `/products/voxi` `/admin/login` 全 200 |
| 支付页面 | 回跳页、待支付页均 200 |
| 安全响应头 | 3/3（CSP / HSTS / Permissions-Policy） |
| mock 回调入口 | 404 |
| cron 端点 | 正常 |
| **真实网关建单** | ✅ `expiration_time=899`；`trade_id`/`payment_url` 均为 string |
| **冷启动** | ✅ 停容器后重启，健康通过 |
| cron 脚本 | ✅ expire-cron.sh / backup-cron.sh 均存在可执行 |

### 本轮加固的行为确认（生产实况）

| 检查项 | 结果 |
|---|---|
| 重购资格 | 已收款订单 `canRepurchase=false`；未收款 `closed` 可重购 |
| 人工商品 | 0（P1-01 库存模式守卫当前无触发对象） |
| 未结束订单 | 0 |

### 回滚方式

```bash
git checkout 92a607b4aca8bb698b584f1b02d3a969d68cbd44
./scripts/deploy.sh
```

---

## 2026-10-12 · `92a607b`（当前生产）

**状态**：已上线并通过验收（发布候选版本）

### 提交

| 项 | 值 |
|---|---|
| SHA | `92a607b4aca8bb698b584f1b02d3a969d68cbd44` |
| 短 SHA | `92a607b` |
| 部署时间 | 2026-10-12T23:20+08:00 |
| 上一版本 | `8d5d4590ea15ee526c908f6a8c87ea0573b0ec98` |
| CI | ✅ success |
| 追赶提交 | 7 个（b91401d、293496e、c3b9c3a、b2163fd、38fb675、7d0768e、92a607b） |

### 本次包含的修复

| 级别 | 内容 |
|---|---|
| P1 | 不限库存（-1）不再被数量回补成 0（意外售罄） |
| P1 | 异常到账补发改用订单 `deliveryType` 快照；后台列表展示快照 |
| P1 | 登录限流增加 IP 维度（防轮换用户名绕过）+ TTL + 批量淘汰 |
| P1 | 伪造 `X-Forwarded-For` 绕过 IP 限流（改取受信段） |
| P1 | 支付创建与回调的状态同步窗口（写回前校验） |
| P2 | 重购状态白名单（expired/closed），服务层 + Action 双重校验 |
| P2 | 重购排除已收款（`paidAt`）与有待处理异常到账的订单 |
| P2 | 库存模式切换（有限↔不限）重置历史订单占用 |
| P2 | 重购资格由服务端统一计算，前台按钮不再自行推断 |
| P2 | 支付回跳页补齐 turnstile 与重购资格配置 |
| — | 订单号冲突重试加 SAVEPOINT（防重复扣库存） |
| — | 惰性清扫在写事务内重新读取；改凭据改为原子提交 |

### 数据库

| 项 | 值 |
|---|---|
| 迁移数 | **9**（本次新增 `0008_order-delivery-type-reconcile`） |
| 0008 预演 | 生产副本上校正 **0 行**（现有数据本已正确，属安全网） |
| integrity_check | ok |
| foreign_key_check | ok |
| 数据 | orders 5 / products 1 / cards 2 / payment_attempts 5 / payment_anomalies 0 |

### 部署前备份

- `pre-92a607b-20261012-232011.db`（212K，VACUUM INTO）
- `env-pre-92a607b-20261012-232011.bak`

### 验收项目

| 项目 | 结果 |
|---|---|
| 容器健康 | 应用 + Caddy 双 healthy（`--wait` 门控） |
| 部署自检 | ✅ 运维脚本就位、cron 指向有效 |
| 迁移 0008 | ✅ 副本预演 0 行校正，生产迁移数 9 |
| 站点 | `/` `/orders` `/products/voxi` `/admin/login` 全 200 |
| 安全响应头 | 3/3（CSP / HSTS / Permissions-Policy） |
| mock 回调入口 | 404 |
| **支付回跳页** | ✅ 200（本轮补齐 turnstile 与资格配置） |
| **真实网关建单** | ✅ `expiration_time=899` |
| **冷启动** | ✅ 停容器后重启，健康通过 |
| cron 脚本 | ✅ expire-cron.sh / backup-cron.sh 均存在可执行 |
| **重购资格** | ✅ 已收款订单 canRepurchase=false；未收款 closed 可重购 |
| **服务器 vs git** | ✅ 153 个文件逐文件 sha256 完全一致 |

### 重购资格在生产上的实际取值

| 订单 | 状态 | 收款 | canRepurchase |
|---|---|---|---|
| LS202610119G3V8759SP | completed | 已收款 | false |
| LS20261011WZCY7VBBKQ | closed | 未收款 | true |
| LS20261011AY9TFWV6XD | closed | 未收款 | true |
| LS20261012SUJ4V6TMS | closed | 未收款 | true |
| LS20261012S8JVGSPFQZ | closed | 未收款 | true |

### 回滚方式

```bash
git checkout 8d5d4590ea15ee526c908f6a8c87ea0573b0ec98
./scripts/deploy.sh
```

> 回滚代码不会撤销迁移 0007 / 0008；`orders.delivery_type` 列会保留
> （旧代码不读它，无副作用）。

---

## 2026-10-12 · `8d5d459`（当前生产）

**状态**：已上线并通过验收

### 提交

| 项 | 值 |
|---|---|
| SHA | `8d5d4590ea15ee526c908f6a8c87ea0573b0ec98` |
| 短 SHA | `8d5d459` |
| 消息 | `docs: 补充库存释放、发货方式快照、限流与客户端 IP 的维护规则` |
| 部署时间 | 2026-10-12T20:38+08:00 |
| 上一版本 | `f6350cda36667b60fd902657a85bf4ad97e7f295`（已记入 `previous`） |
| CI | ✅ success |

### 本次包含的修复（独立审计）

| 级别 | 内容 |
|---|---|
| P0 | 人工库存重复回补（统一释放入口 + 幂等）—— 实测复现 3→2→3→**4** |
| P1 | 商品改发货方式影响已有订单（`deliveryType` 快照，迁移 0007） |
| P1 | 登录限流可被轮换用户名绕过 + 内存可撑爆（IP 维度 + TTL + 批量淘汰） |
| P1 | 伪造 `X-Forwarded-For` 绕过 IP 限流（改取受信段） |
| P1 | 支付创建与回调的状态同步窗口（写回前校验状态与尝试新旧） |
| P2 | 订单号冲突重试重复扣库存（SAVEPOINT）—— 实测 10→9→**8** |
| P2 | 惰性清扫在写事务内重新读取订单 |
| P2 | 管理员改凭据改为「先全量校验、再单事务提交」 |
| — | 页脚「Powered by liteshop」绑定开源仓库地址（后台可配置） |

### 数据库

| 项 | 值 |
|---|---|
| 迁移数 | **8**（本次新增 `0007_order-delivery-type-snapshot`） |
| 新增列 | `orders.delivery_type` |
| 回填 | 5 条历史订单全部按商品类型回填为 `auto` |
| integrity_check | ok |
| foreign_key_check | ok |
| 数据 | orders 5 / products 1 / cards 2 / payment_attempts 5 |

### 部署前备份

- `pre-8d5d459-20261012-203815.db`（200K，VACUUM INTO）
- `env-pre-8d5d459-20261012-203815.bak`

**迁移在副本上预演过**：确认 `delivery_type` 从无到有、5 条订单正确回填、integrity ok
之后才部署。

### 验收项目

| 项目 | 结果 |
|---|---|
| 容器健康 | 应用 + Caddy 双 healthy（`--wait` 门控） |
| 运维脚本自检 | ✅「运维脚本就位」「定时任务指向的脚本均存在」 |
| 迁移 0007 | ✅ 生产直查：列存在、迁移数 8、回填正确 |
| 站点 | `/` `/orders` `/products/voxi` `/admin/login` 全 200 |
| 安全响应头 | 3/3 |
| 页脚仓库链接 | ✅ 渲染为 `target="_blank" rel="noopener noreferrer"` |
| mock 回调入口 | 404 |
| 真实网关建单 | ✅ `expiration_time=899` |
| 冷启动 | ✅ 停容器后重启，健康通过 |
| cron 脚本 | ✅ 两个脚本存在且可执行 |
| **服务器 vs git** | ✅ 146 个文件逐文件 sha256 完全一致 |
| 目录卫生 | 0 个 AppleDouble，`.env` 保留 |

### 回滚方式

```bash
git checkout f6350cda36667b60fd902657a85bf4ad97e7f295
./scripts/deploy.sh
```

> 注意：回滚代码不会撤销迁移 0007。`orders.delivery_type` 列会保留
> （旧代码不读它，无副作用）。

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
