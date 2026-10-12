import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 全站数据每请求实时读取（SQLite），不使用 Cache Components 的静态优先模型
  cacheComponents: false,
  // Docker 部署：输出自包含产物（server.js）
  output: "standalone",
  // 不暴露技术栈指纹（减少针对性扫描）
  poweredByHeader: false,
  // better-sqlite3 为原生模块，禁止打包进 bundle
  serverExternalPackages: ["better-sqlite3"],
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
