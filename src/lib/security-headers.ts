/**
 * Content-Security-Policy（next.config.ts 注入全站）。
 *
 * - 脚本：本站 + Cloudflare Turnstile；Next App Router 的内联引导脚本需要 'unsafe-inline'
 *   （无 nonce 方案，nonce 会让全部页面失去静态/ISR 缓存）；开发模式另需 'unsafe-eval'
 * - 图片：商品图由后台填写任意 https 地址
 * - 表单只允许提交到本站；禁止被任何站点嵌入
 * - 跳转收银台是顶层导航，不受 CSP 限制
 */
const TURNSTILE = "https://challenges.cloudflare.com";

export function contentSecurityPolicy(dev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ""} ${TURNSTILE}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: https:",
    "font-src 'self' data:",
    `connect-src 'self' ${TURNSTILE}`,
    `frame-src ${TURNSTILE}`,
    "frame-ancestors 'none'",
    "form-action 'self'",
    "base-uri 'self'",
    "object-src 'none'",
  ].join("; ");
}

/** 把任意数据安全嵌入 <script type="application/ld+json">：转义 < 防止 </script> 截断注入 */
export function jsonForScriptTag(data: unknown): string {
  return JSON.stringify(data).replace(/</g, "\\u003c");
}
