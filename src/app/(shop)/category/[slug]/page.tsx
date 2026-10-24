import type { Metadata } from "next";
import { formatMoney } from "@/lib/money";
import { getSiteCurrency } from "@/server/settings";
import { listStoreProducts } from "@/server/catalog";
import { notFound } from "next/navigation";
import { getCategoryBySlug } from "@/server/catalog";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "分类不存在" };
  return {
    title: category.name,
    description: category.description || `${category.name} 分类下的数字商品`,
    alternates: { canonical: `/category/${category.slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();
  const [items, currency] = await Promise.all([
    listStoreProducts({ categorySlug: slug }),
    getSiteCurrency(),
  ]);

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-serif text-2xl font-semibold tracking-tight">{category.name}</h1>
        {category.description ? <p className="mt-1 text-sm text-muted">{category.description}</p> : null}
      </header>
      {items.length === 0 ? (
        <p className="py-16 text-center text-sm text-muted">该分类暂无商品</p>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.slug}>
              <a
                href={`/products/${p.slug}`}
                className="flex h-full flex-col justify-between rounded-xl border border-line bg-surface p-5 hover:shadow-md"
              >
                <div className="space-y-2">
                  <h2 className="font-serif text-base font-semibold">{p.name}</h2>
                  <p className="line-clamp-2 text-sm text-muted">{p.description}</p>
                </div>
                <span className="mt-4 font-semibold">{formatMoney(p.priceCents, currency)}</span>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
