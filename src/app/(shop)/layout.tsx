import { CartProvider } from "@/components/shop/cart";
import { getSiteCurrency, getSiteName, getSupportUrl } from "@/server/settings";
import Link from "next/link";

export default async function ShopLayout({ children }: { children: React.ReactNode }) {
  // 构建期预渲染静态页（/cart 等）时数据库不可用 → 回落默认值
  let siteName = "liteshop";
  let supportUrl: string | null = null;
  let currency = "USD";
  try {
    [siteName, supportUrl, currency] = await Promise.all([
      getSiteName(),
      getSupportUrl(),
      getSiteCurrency(),
    ]);
  } catch {
    /* build-time fallback */
  }
  return (
    <CartProvider currency={currency}>
      <div className="flex min-h-screen flex-col">
        <header className="border-b border-line">
          <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-4">
            <Link href="/" className="font-serif text-lg font-semibold tracking-[-0.02em]">
              {siteName}
            </Link>
            <nav className="flex items-center gap-5 text-sm text-muted">
              <Link href="/" className="transition-colors hover:text-fg">
                商品
              </Link>
              <Link href="/cart" className="transition-colors hover:text-fg">
                购物车
              </Link>
              <Link href="/orders/query" className="transition-colors hover:text-fg">
                订单查询
              </Link>
            </nav>
          </div>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-10 sm:py-12">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-2 px-4 py-6 text-xs text-muted">
            <span>
              © {new Date().getFullYear()} {siteName} · 数字商品 · 支付后自动发货
            </span>
            {supportUrl ? (
              <a href={supportUrl} target="_blank" rel="noopener noreferrer" className="transition-colors hover:text-fg">
                联系客服
              </a>
            ) : null}
          </div>
        </footer>
      </div>
    </CartProvider>
  );
}
