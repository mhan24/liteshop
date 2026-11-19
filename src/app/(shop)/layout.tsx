import Link from "next/link";
import { CartProvider } from "@/components/shop/cart";
import { CartLink } from "@/components/shop/cart-link";
import { getSiteName, getSupportUrl } from "@/server/settings";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // 构建期预渲染静态页（/cart 等）时数据库不可用 → 回落默认值
  let siteName = "liteshop";
  let supportUrl: string | null = null;
  try {
    [siteName, supportUrl] = await Promise.all([getSiteName(), getSupportUrl()]);
  } catch {
    /* build-time fallback */
  }

  return (
    <CartProvider>
      <div className="flex min-h-screen flex-col">
        <header className="sticky top-0 z-20 border-b border-line bg-bg/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
            <Link href="/" className="group inline-flex items-center gap-2.5 font-semibold tracking-[-0.01em]">
              <span
                aria-hidden
                className="data grid size-6 place-items-center rounded-sm border border-accent/40 bg-accent/10 text-[11px] text-accent transition-colors group-hover:bg-accent/20"
              >
                {siteName.slice(0, 1).toUpperCase()}
              </span>
              {siteName}
            </Link>
            <nav className="flex items-center gap-5 text-sm text-muted sm:gap-7">
              <Link href="/" className="transition-colors hover:text-fg">
                商品
              </Link>
              <CartLink />
              <Link href="/orders/query" className="transition-colors hover:text-fg">
                订单查询
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-12 sm:px-6 sm:py-16">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-6xl flex-col gap-3 px-4 py-8 text-xs leading-5 text-faint sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <p className="flex items-center gap-2">
              <span aria-hidden className="live-dot text-success" />
              <span>
                © {new Date().getFullYear()} {siteName} · 付款确认后自动发卡
              </span>
            </p>
            <div className="flex items-center gap-5">
              <span className="data">USDT · USDC</span>
              {supportUrl ? (
                <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="text-muted transition-colors hover:text-accent">
                  联系客服
                </a>
              ) : null}
            </div>
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}
