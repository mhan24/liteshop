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
      default: `${siteName} · 数字卡密商店`,
      template: `%s · ${siteName}`,
    },
    description: "数字卡密商店，付款确认后自动发卡并同步发送至下单邮箱，随时凭订单号、邮箱和查单密码查询。",
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
        {children}
      </body>
    </html>
  );
}
