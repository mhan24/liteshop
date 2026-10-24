import Link from "next/link";
import type { Metadata } from "next";
import { formatMoney } from "@/lib/money";
import { getSiteCurrency } from "@/server/settings";
import { listStoreProducts } from "@/server/catalog";
import { Badge } from "@/components/ui/input";

export const revalidate = 60;

export const metadata: Metadata = {
  title: "挑选商品",
  description: "数字卡密商品列表：下单支付后自动发货，卡密秒到。",
  alternates: { canonical: "/" },
};

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;
  const [items, currency] = await Promise.all([listStoreProducts({ q, categorySlug: category }), getSiteCurrency()]);

  return (
    <div className="space-y-8">
      <section className="text-center">
        <h1 className="font-serif text-3xl font-semibold tracking-tight">挑选商品，卡密秒到。</h1>
        <p className="mt-2 text-sm text-muted">下单支付后自动发货；凭订单号 + 查单密码随时查看卡密。</p>
      </section>

      <form action="/" className="flex gap-2">
        <input
          name="q"
          defaultValue={q ?? ""}
          placeholder="搜索商品…"
          aria-label="搜索商品"
          className="h-10 flex-1 rounded-lg border border-line bg-surface px-3 text-sm"
        />
        <button
          type="submit"
          className="h-10 rounded-lg bg-accent px-4 text-sm font-medium text-accent-fg hover:opacity-90"
        >
          搜索
        </button>
      </form>

      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">没有匹配的商品</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.slug}>
              <Link
                href={`/products/${p.slug}`}
                className="group flex h-full flex-col justify-between rounded-xl border border-line bg-surface p-5 transition-shadow hover:shadow-md"
              >
                <div className="space-y-2">
                  <div className="flex items-start justify-between gap-2">
                    <h2 className="font-serif text-base font-semibold">{p.name}</h2>
                    <Badge>{p.deliveryType === "auto" ? "自动发卡" : "人工发货"}</Badge>
                  </div>
                  <p className="line-clamp-2 text-sm text-muted">{p.description}</p>
                </div>
                <div className="mt-4 flex items-center justify-between">
                  <span className="font-semibold">{formatMoney(p.priceCents, currency)}</span>
                  <span className={`text-xs ${p.inStock ? "text-muted" : "text-danger"}`}>
                    {p.stockDisplay === null ? "可购买" : p.inStock ? `余 ${p.stockDisplay}` : "缺货"}
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
