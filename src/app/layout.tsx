import type { Metadata } from "next";
import "./globals.css";
import { getSiteName } from "@/server/settings";

export async function generateMetadata(): Promise<Metadata> {
  let siteName = "liteshop";
  try {
    siteName = await getSiteName();
  } catch {
    // 数据库尚未初始化（如首次构建）时回落默认值
  }
  return {
    title: {
      default: `${siteName} · 数字商品自动发货`,
      template: `%s · ${siteName}`,
    },
    description: "挑选数字商品，付款后卡密自动发放到邮箱；凭订单号与查单密码随时取回。",
    metadataBase: new URL(process.env.SITE_URL ?? "http://localhost:3000"),
    openGraph: {
      type: "website",
      siteName,
    },
    robots: { index: true, follow: true },
  };
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        {/* 无 JS 环境下不做入场隐藏，保证内容可见 */}
        <noscript>
          <style>{".reveal{opacity:1 !important;transform:none !important}"}</style>
        </noscript>
        {children}
      </body>
    </html>
  );
}
