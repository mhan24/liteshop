import type { NextConfig } from "next";

/**
 * 安全响应头（纵深防御）。
 *
 * 生产环境由 Caddy 统一注入（见 Caddyfile），这里在**应用层**再设一份：
 * 应用不应把安全属性依赖于「反代一定配对了」这一外部前提 —— 换部署方式、
 * 少一层代理、或直连容器端口时，浏览器侧的防护就会消失。
 * 两处配置取并集：Caddy 的更严格（preload/HSTS 长 max-age），
 * 应用层保证「无论是否经由 Caddy 都至少有一份」。
 */
const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-DNS-Prefetch-Control", value: "off" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Next.js 会内联少量启动脚本；'unsafe-inline' 为既有渲染所需，
      // 故用 frame-ancestors 与 object-src 'none' 收紧实际可利用面
      "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "font-src 'self' data:",
      "connect-src 'self' https://challenges.cloudflare.com",
      "frame-src https://challenges.cloudflare.com",
      "frame-ancestors 'none'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // 全站数据每请求实时读取（SQLite），不使用 Cache Components 的静态优先模型
  cacheComponents: false,
  // Docker 部署：输出自包含产物（server.js）
  output: "standalone",
  // 不暴露技术栈指纹（减少针对性扫描）
  poweredByHeader: false,
  // better-sqlite3 为原生模块，禁止打包进 bundle
  serverExternalPackages: ["better-sqlite3"],
  // 全站应用这些响应头（source: "/:path*" 覆盖全部路由）
  async headers() {
    return [
      {
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
