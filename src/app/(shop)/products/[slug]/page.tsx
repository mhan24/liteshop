import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { getProductBySlug } from "@/server/catalog";
import { getSiteCurrency } from "@/server/settings";
import { getSiteUrl } from "@/server/settings";
import { Badge } from "@/components/ui/input";
import { AddToCart } from "@/components/shop/add-to-cart";

export const revalidate = 60;

export async function generateStaticParams() {
  // 增量静态生成：首请求时渲染并缓存，商品变更由后台 revalidatePath 失效
  return [];
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  const product = await getProductBySlug(slug);
  if (!product) return { title: "商品不存在" };
  const description =
    product.description.slice(0, 150) || "数字卡密商品，支付后自动发货。";
  return {
    title: product.name,
    description,
    alternates: { canonical: `/products/${product.slug}` },
    openGraph: {
      title: product.name,
      description,
      type: "website",
      images: product.imageUrl ? [product.imageUrl] : undefined,
    },
  };
}

export default async function ProductPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [product, currency, siteUrl] = await Promise.all([
    getProductBySlug(slug),
    getSiteCurrency(),
    getSiteUrl(),
  ]);
  if (!product) notFound();

  const jsonLd = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    description: product.description || undefined,
    image: product.imageUrl || undefined,
    sku: product.slug,
    offers: {
      "@type": "Offer",
      url: `${siteUrl}/products/${product.slug}`,
      priceCurrency: currency,
      price: (product.priceCents / 100).toFixed(2),
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <article className="grid gap-10 py-6 lg:grid-cols-[1.2fr_1fr] lg:py-10">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="space-y-5">
        <nav className="text-xs text-muted" aria-label="面包屑">
          <Link href="/" className="hover:text-fg">
            商品
          </Link>
          {product.categorySlug ? (
            <>
              {" / "}
              <Link href={`/?category=${product.categorySlug}`} className="hover:text-fg">
                {product.categoryName}
              </Link>
            </>
          ) : null}
          {" / "}
          <span>{product.name}</span>
        </nav>
        <div className="space-y-4">
          <div className="flex items-start gap-3">
            <h1 className="font-serif text-3xl font-semibold leading-[1.15] tracking-[-0.02em] sm:text-4xl">
              {product.name}
            </h1>
            <Badge tone={product.deliveryType === "auto" ? "green" : "yellow"} className="mt-2 shrink-0">
              {product.deliveryType === "auto" ? "自动发卡" : "人工发货"}
            </Badge>
          </div>
          <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{product.description}</p>
        </div>
      </section>

      <aside className="lg:sticky lg:top-10 lg:self-start">
        <div className="space-y-5 rounded-xl border border-line bg-surface p-8">
          <div className="space-y-1">
            <p className="font-serif text-3xl font-semibold tracking-tight">
              {formatMoney(product.priceCents, currency)}
            </p>
            <p className={`text-xs ${product.inStock ? "text-muted" : "text-tint-red-fg"}`}>
              {product.stockDisplay === null ? "现货，下单即发" : product.inStock ? `余量 ${product.stockDisplay}` : "缺货"}
            </p>
          </div>
          <AddToCart slug={product.slug} name={product.name} priceCents={product.priceCents} inStock={product.inStock} />
          <Link
            href="/cart"
            className="inline-flex h-10 w-full items-center justify-center rounded-md border border-line text-sm font-medium transition-colors hover:bg-surface-2 active:scale-[0.98]"
          >
            查看购物车并结算
          </Link>
          <div className="space-y-1.5 border-t border-line pt-4 text-xs leading-5 text-muted">
            <p>付款成功后卡密立即发放，并同步发送至你的邮箱。</p>
            <p>订单与卡密可在「订单查询」页凭订单号、邮箱与查单密码随时查看。</p>
          </div>
        </div>
      </aside>
    </article>
  );
}
