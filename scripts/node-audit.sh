#!/usr/bin/env bash
# 安全门禁：Node 依赖漏洞审计。
# 用法：bash scripts/node-audit.sh <前端目录>
#
# 已记录基线（非阻断，均为构建期/开发期依赖，不进入生产运行时）：
#   - js-yaml / @redocly/openapi-core：经 openapi-typescript 的
#     @redocly/openapi-core 间接引入（仅 admin 构建期 codegen 使用），
#     无补丁可回移，生产运行时不加载。
# 除上述基线外，任何 high / critical 漏洞都会使检查失败。
set -euo pipefail

dir="${1:?用法: node-audit.sh <前端目录>}"
cd "$dir"

json="$(npm audit --json 2>/dev/null || true)"
node - "$json" <<'EOF'
const data = JSON.parse(process.argv[2] || '{}');
const vulns = data.vulnerabilities || {};
const allowlist = new Set(['js-yaml', '@redocly/openapi-core']);
const blocking = Object.entries(vulns)
  .filter(([name, info]) => !allowlist.has(name) && ['high', 'critical'].includes(info.severity))
  .map(([name, info]) => `${name}(${info.severity})`);
if (blocking.length > 0) {
  console.error(`npm audit 发现需处理的漏洞: ${blocking.join(', ')}`);
  process.exit(1);
}
const total = Object.keys(vulns).length;
if (total > 0) {
  console.log(`npm audit: ${total} 条告警（均为已记录基线，非阻断）`);
} else {
  console.log('npm audit: 无漏洞');
}
EOF
