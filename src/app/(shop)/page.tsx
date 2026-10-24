import Link from "next/link";
import type { Metadata } from "next";
import { getSiteCurrency } from "@/server/settings";
import { listStoreProducts } from "@/server/catalog";
import { ProductCard } from "@/components/shop/product-card";
import { Reveal } from "@/components/shop/reveal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "挑选商品",
  description: "挑选数字商品，付款后卡密自动发放到邮箱；凭订单号与查单密码随时取回。",
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
    <div className="space-y-12">
      {/* Hero：衬线大标题 + 紧字距，背后一层极淡光斑增加纵深 */}
      <section className="relative px-2 py-16 text-center sm:py-20">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-72 w-[36rem] max-w-full -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(17,17,17,0.03),transparent)]"
        />
        <p className="text-xs uppercase tracking-[0.2em] text-muted">数字商品 · 自动发货</p>
        <h1 className="mx-auto mt-4 max-w-2xl font-serif text-4xl font-semibold leading-[1.1] tracking-[-0.03em] sm:text-5xl">
          挑选商品，卡密秒到。
        </h1>
        <p className="mx-auto mt-5 max-w-xl text-sm leading-6 text-muted">
          付款确认后卡密自动发放，并发送至你的邮箱；凭订单号与查单密码，随时取回已购内容。
        </p>

        <form action="/" className="relative mx-auto mt-8 flex max-w-md gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索商品名称…"
            aria-label="搜索商品"
            className="h-10 flex-1 rounded-md border border-line bg-surface px-3 text-sm placeholder:text-muted/60 focus:border-fg"
          />
          <button
            type="submit"
            className="h-10 rounded-md bg-accent px-5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            搜索
          </button>
        </form>
      </section>

      {items.length === 0 ? (
        <div className="space-y-2 py-16 text-center">
          <p className="font-serif text-lg">没有找到相关商品</p>
          <p className="text-sm text-muted">换个关键词，或清除筛选条件后再试。</p>
          {q || category ? (
            <p className="pt-2">
              <Link href="/" className="text-sm text-fg underline decoration-line underline-offset-4 hover:decoration-fg">
                清除筛选
              </Link>
            </p>
          ) : null}
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p, i) => (
            <li key={p.slug}>
              <Reveal index={i % 6}>
                <ProductCard product={p} currency={currency} />
              </Reveal>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
