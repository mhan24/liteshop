import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCategoryBySlug, listStoreProducts } from "@/server/catalog";
import { ProductCard } from "@/components/shop/product-card";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) return { title: "分类不存在" };
  return {
    title: category.name,
    description: category.description || `${category.name} 分类下的数字卡密商品`,
    alternates: { canonical: `/category/${category.slug}` },
  };
}

export default async function CategoryPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const category = await getCategoryBySlug(slug);
  if (!category) notFound();
  const items = await listStoreProducts({ categorySlug: slug });

  return (
    <div className="space-y-8">
      <header className="space-y-2 border-b border-line pb-6">
        <p className="eyebrow">分类</p>
        <h1 className="text-3xl font-semibold tracking-[-0.025em]">{category.name}</h1>
        {category.description ? (
          <p className="max-w-xl text-sm leading-6 text-muted">{category.description}</p>
        ) : null}
      </header>

      {items.length === 0 ? (
        <div className="space-y-2 rounded-md border border-line bg-surface px-6 py-16 text-center">
          <p className="text-lg">该分类暂无商品</p>
          <p className="text-sm text-muted">
            可以先浏览全部商品，
            <Link href="/" className="text-fg underline decoration-line underline-offset-4 hover:decoration-fg">
              返回首页
            </Link>
            。
          </p>
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.slug}>
              <ProductCard product={p} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
