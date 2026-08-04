# LiteShop 代码审计报告

**审计范围**：Go 后端（`internal/`、`cmd/`）、Docker/部署脚本、Vue/Nuxt 前端静态检查
**审计时间**：2026-08-04
**审计方式**：静态代码审查（本机无 Go 工具链，未执行动态测试）

---

## 一、执行摘要

LiteShop 是一个结构清晰、功能完整的自动发卡系统。整体架构已按 **web → service → repository → db** 分层重构，核心订单/商品领域抽离良好，具备 RBAC、审计日志、订单状态机、事件通知等企业级特性。

代码质量整体较高，但审计发现 **1 个高危功能缺陷**（Docker 环境补发功能失效）、**2 个中危安全配置问题**（`api.go` 缺失包声明、敏感配置未遮蔽）以及 **3 个低危健壮性问题**。

---

## 二、发现汇总

| 级别 | 数量 | 说明 |
| --- | --- | --- |
| 🔴 高危 | 1 | `UPDATE ... LIMIT` SQL 语法在生产 Docker 环境报错 |
| 🟡 中危 | 2 | `api.go` 缺失包声明（无法编译）；敏感配置（SMTP/TG Token）对 viewer 角色泄露 |
| 🟢 低危 | 3 | 死代码、时区耦合、审计日志不完整 |

---

## 三、详细发现

### 🔴 高危：`UPDATE ... LIMIT` SQL 语法导致补发功能失效

**文件**：`internal/order/repository.go:223-229`

```go
func (r *Repository) ReserveCardsFromStock(productID int64, qty int, orderID int64) (int, error) {
	res, err := r.db.Exec(`UPDATE cards SET status = 'locked', reserved_order = ?, updated_at = ? WHERE product_id = ? AND status = 'available' LIMIT ?`, orderID, models.Now(), productID, qty)
```

**问题**：
- SQLite 的 `UPDATE ... LIMIT` 语法需要编译时启用 `SQLITE_ENABLE_UPDATE_DELETE_LIMIT` 扩展。
- `modernc.org/sqlite@v1.34.4` 在所有平台（darwin/linux, amd64/arm64）的预编译库中 **均未启用该扩展**（审计已验证 `lib/sqlite_linux_amd64.go` 等文件无此宏定义）。
- 生产 Docker 镜像使用 `golang:1.22-bookworm` 构建，同样基于该库，因此执行此 SQL 会返回 `near "LIMIT": syntax error`。
- 该函数被 `Service.Redeliver` 调用（管理员补发卡密），属于核心运营功能。

**影响**：管理员在后台对发卡失败订单执行"补发"操作时，会收到语法错误，无法从库存补扣卡密。

**修复建议**：
避免使用 `LIMIT`，改用子查询或临时表：

```go
// 方案 1：子查询（推荐）
res, err := r.db.Exec(`
    UPDATE cards SET status = 'locked', reserved_order = ?, updated_at = ?
    WHERE id IN (
        SELECT id FROM cards
        WHERE product_id = ? AND status = 'available'
        ORDER BY id
        LIMIT ?
    )`, orderID, models.Now(), productID, qty)

// 方案 2：先 SELECT 再 UPDATE（与 CreatePendingOrder 风格一致）
```

**验证方式**：本地可通过 `sqlite3 :memory: "PRAGMA compile_options;"` 确认；CI 中应补充 `Redeliver` 集成测试。

---

### 🟡 中危：`internal/web/api.go` 缺失 `package web` 声明

**文件**：`internal/web/api.go:1`

**问题**：文件第 1 行为空行，第 2 行为 `import (...)`，缺少 `package web` 声明。这会导致任何 Go 编译器直接报错，项目无法构建。

**影响**：完全阻断构建，CI/CD 和本地开发均失败。

**修复建议**：在文件顶部添加：
```go
package web
```

---

### 🟡 中危：敏感配置信息对 viewer 角色泄露

**文件**：`internal/web/api.go:77-78`（路由）及 `1059+`（handler）

```go
mux.Handle("GET /api/v1/admin/notify", s.requireAdminAPI(http.HandlerFunc(s.apiAdminNotify)))
```

**问题**：
- `requireAdminAPI` 仅要求 `RoleViewer`（最低权限），即可读取通知配置。
- `apiAdminNotify` 返回的 `cfg` 包含 `SMTPPassword`、`TelegramBotToken`、`WebhookURL` 等敏感信息（即使脱敏为 `smtp_password_set` 布尔值，其他字段如 `SMTPHost`、`SMTPUsername` 仍泄露）。
- 对比：保存接口 `apiAdminNotifySave` 要求 `RoleAdmin`，读取却允许 viewer。

**影响**：低权限运营人员可获取系统通知基础设施的敏感配置，存在横向移动风险。

**修复建议**：
```go
mux.Handle("GET /api/v1/admin/notify", s.requireRole(models.RoleOperator, http.HandlerFunc(s.apiAdminNotify)))
// 或仅返回非敏感字段：
writeJSON(w, 200, map[string]any{
    "smtp_host": cfg.SMTPHost,  // 允许
    // 不返回 SMTPUsername/Password/TelegramToken
})
```

---

### 🟢 低危：死代码与遗留函数

**文件**：
- `internal/web/api.go:1034`：`func (s *Server) saveIfPresent(map[string]string) {}` 为空实现，未被调用。
- `internal/web/server.go`：存在多处注释掉的旧 handler（如 `getProductViewBySlug`、`markPaid` 等）仅留注释，可彻底删除。

**建议**：删除未使用的函数和注释块，保持代码整洁。

---

### 🟢 低危：时间处理耦合北京时间

**文件**：`internal/models/models.go:188-193`

```go
var BeijingLocation = time.FixedZone("Asia/Shanghai", 8*3600)
func StartOfDay(now int64) int64 { ... }
```

**问题**：
- 系统硬编码使用北京时间，但 `siteSettings` 支持 `Timezone` 配置（`site_timezone`）。
- `StartOfDay`、`FormatBeijing` 未读取配置，导致多语言/多地区站点统计时间不正确。

**建议**：将 `Timezone` 配置注入 `models` 或通过 `service` 层传递，避免全局硬编码。

---

### 🟢 低危：审计日志不完整

**文件**：`internal/web/api.go`（多处）

**问题**：
- `apiAdminSettingsSave`、`apiAdminNotifySave`、`apiAdminSiteSave` 等写操作未记录审计日志（`s.audit`）。
- 对比：`apiAdminProductCreate`、`apiAdminOrderSetStatus` 等已记录。

**建议**：统一在所有写操作 handler 末尾添加 `s.audit(...)`，记录变更前后的关键字段。

---

## 四、安全审查

### 4.1 认证与会话
- ✅ 密码使用 PBKDF2-SHA256（10 万次迭代）加盐哈希，存储格式规范。
- ✅ Session 使用 HMAC-SHA256 签名，Cookie 设置 `HttpOnly` + `SameSite=Lax`。
- ✅ 登录接口限流（10 次/分钟），下单接口限流（20 次/分钟）。
- ⚠️ **建议**：为 `shop_session` Cookie 增加 `Secure: true` 属性（当前仅依赖 Caddy HTTPS，若纯 HTTP 部署会泄露）。

### 4.2 SQL 注入
- ✅ 所有 SQL 均使用 `?` 占位符参数化，未发现字符串拼接注入点。
- ✅ `ResetAllTables` 中 `fmt.Sprintf("DELETE FROM %s", t)` 的表名来自硬编码白名单，安全。

### 4.3 XSS
- ✅ 前端商品描述使用 `markdown-it` 渲染（`html: false`），禁止原始 HTML，无 XSS 风险。
- ✅ 后台使用 Element Plus 组件，无 `v-html` 直接输出用户输入。

### 4.4 CSRF
- ✅ API 使用 JSON 通信，无表单 CSRF 风险。
- ⚠️ 管理后台 Cookie 认证，但操作均为 POST，且 `SameSite=Lax` 可缓解大部分 CSRF。

### 4.5 敏感信息
- ✅ `bepusdt_api_token` 保存后仅返回 `bepusdt_api_token_set` 布尔值，不泄露明文。
- ⚠️ `apiAdminNotify` 返回的 `cfg` 对象包含 `SMTPPassword`、`TelegramBotToken`（见中危 #2）。

---

## 五、架构与代码质量

### 优点
1. **分层清晰**：`web → service → repository → db` 职责明确，handler 无业务逻辑。
2. **事务安全**：`CreatePendingOrder`、`MarkPaid`、`DeliverCards` 等关键操作均在事务中执行，卡密锁定/释放无竞态。
3. **状态机严谨**：`validOrderTransitions` 明确定义状态迁移，防止非法回退。
4. **可观测性**：订单事件日志（`order_logs`）+ 管理员审计日志（`audit_logs`）双轨记录。
5. **部署友好**：提供 Docker Compose、一键安装脚本、Caddy 自动 HTTPS，覆盖 NAS/云服务器场景。

### 建议
1. **配置聚合**：`siteSettings`/`paymentConfig`/`notifyConfig` 的读取散落在 handler 中，建议抽离为 `internal/settings` 服务，统一缓存和校验。
2. **测试覆盖**：`order_state_test.go` 和 `rbac_test.go` 覆盖了核心路径，但缺少 `Redeliver`、`SystemReset`、Turnstile 验证等边界测试。
3. **时区抽象**：移除 `models.BeijingLocation` 全局变量，改为依赖注入。

---

## 六、修复优先级

| 优先级 | 问题 | 工作量 | 风险 |
| --- | --- | --- | --- |
| P0 | `api.go` 缺失 `package web` | 1 分钟 | 阻断构建 |
| P0 | `UPDATE ... LIMIT` 语法错误 | 30 分钟 | 核心功能失效 |
| P1 | `apiAdminNotify` 权限收紧 | 15 分钟 | 敏感信息泄露 |
| P2 | 审计日志补全 | 1 小时 | 合规性 |
| P3 | 死代码清理、时区抽象 | 2 小时 | 可维护性 |

---

## 七、结论

LiteShop 是一个**功能完整、架构合理**的自动发卡系统，具备生产级特性（RBAC、审计、状态机、事件通知）。发现的高危问题为 **SQL 语法兼容性** 和 **包声明缺失**，均属低级但影响严重的错误，建议立即修复。整体代码质量高于同类开源项目，修复后可安全用于生产环境。

**审计人**：AI Assistant
**报告生成时间**：2026-08-04
