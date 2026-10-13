<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 发布流程（必须遵守）

**代码改动只推送到 GitHub，不要自动部署到生产环境。**

1. 改完代码 → 本地验证（`npm test`、`npx tsc --noEmit`、`npm run lint`）→ `git push`
2. **停下**，等待用户明确下达部署指令（例如「部署」「上线」「推到生产」）
3. 收到指令后才执行 `./scripts/deploy.sh`

不要因为「改动很小」「CI 已通过」「用户之前同意过部署」就自行部署。
每次部署都必须是用户当次的显式指令。

原因：生产承载真实交易与卡密数据，部署是不可逆动作，且
`/opt/liteshop/.env` 含有真实支付网关凭证。把「构建/部署」与「提交代码」
解耦，可以让用户在任何一次上线前决定时机。

例外：用户明确说「部署」时正常执行；用户说「只推 GitHub」时仅推送。

## 生产环境信息

- 部署凭证在 `.deploy.env`（**不入库**，见 `.deploy.env.example`）
- 服务器目录 `/opt/liteshop`；备份在 `/root/liteshop-backups/`
- 部署前脚本会自动校验 `.env` 指纹，防止覆盖生产配置


## 审计工作流程

用户约定：每轮审计都包含修复发现的问题、补充回归测试、本地验证、提交并推送 GitHub，以及更新审计报告。不要只出具报告后停止。生产部署仍遵守上述发布流程，等待用户当次明确部署指令。
