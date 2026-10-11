import Link from "next/link";
import type { Metadata } from "next";
import { getSiteName } from "@/server/settings";

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await Promise.resolve(getSiteName());
  return {
    title: { default: siteName, template: `%s · ${siteName}` },
    description: "数字商品在线购买，支付后自动发货",
  };
}

export default function ShopLayout({ children }: { children: React.ReactNode }) {
  const siteName = getSiteName();
  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="border-b border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <Link href="/" className="font-serif text-xl tracking-tight">
            {siteName}
          </Link>
          <nav className="flex items-center gap-5 text-sm text-muted-foreground">
            <Link href="/" className="transition-colors hover:text-foreground">
              商品
            </Link>
            <Link href="/orders" className="transition-colors hover:text-foreground">
              订单查询
            </Link>
          </nav>
        </div>
      </header>

      <div className="flex-1">{children}</div>

      <footer className="border-t border-border">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 text-xs text-muted-foreground">
          <span>{siteName}</span>
          <span className="font-mono">Powered by liteshop</span>
        </div>
      </footer>
    </div>
  );
}
