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
        <header className="border-b border-line bg-bg/85 backdrop-blur-sm sticky top-0 z-20">
          <div className="mx-auto flex h-16 max-w-5xl items-center justify-between gap-4 px-4">
            <Link href="/" className="font-serif text-lg font-semibold tracking-[-0.02em]">
              {siteName}
            </Link>
            <nav className="flex items-center gap-6 text-sm text-muted">
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
        <main className="mx-auto w-full max-w-5xl flex-1 px-4 py-12 sm:py-16">{children}</main>
        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-5xl flex-col gap-2 px-4 py-8 text-xs leading-5 text-muted sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()} {siteName} · 数字卡密，付款后自动发放
            </p>
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
