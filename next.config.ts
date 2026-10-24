import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 单体 standalone 部署（Docker 多阶段构建直接运行 server.js）
  output: "standalone",
  reactStrictMode: true,
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
      // 订单、支付、结算、后台与回调接口禁止被搜索引擎索引（双保险：另有 robots.ts + 页面 metadata）
      ...["/orders/:path*", "/checkout/:path*", "/pay/:path*", "/admin/:path*", "/api/:path*"].map(
        (source) => ({
          source,
          headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
        })
      ),
    ];
  },
};

export default nextConfig;
