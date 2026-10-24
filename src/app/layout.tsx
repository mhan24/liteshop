import type { Metadata } from "next";
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
    description: "数字卡密商城：下单支付后自动发货，卡密秒到。",
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
      <body>{children}</body>
    </html>
  );
}
