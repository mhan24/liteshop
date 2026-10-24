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
    <article className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />
      <section className="space-y-4">
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
        <div className="flex items-center gap-3">
          <h1 className="font-serif text-2xl font-semibold tracking-tight">{product.name}</h1>
          <Badge>{product.deliveryType === "auto" ? "自动发卡" : "人工发货"}</Badge>
        </div>
        <p className="whitespace-pre-wrap text-sm leading-6 text-muted">{product.description}</p>
      </section>

      <aside className="lg:sticky lg:top-8 lg:self-start">
        <div className="space-y-4 rounded-xl border border-line bg-surface p-6">
          <p className="font-serif text-2xl font-semibold">{formatMoney(product.priceCents, currency)}</p>
          <p className={`text-xs ${product.inStock ? "text-muted" : "text-danger"}`}>
            {product.stockDisplay === null ? "现货可购" : product.inStock ? `库存 ${product.stockDisplay}` : "缺货"}
          </p>
          <AddToCart slug={product.slug} name={product.name} priceCents={product.priceCents} inStock={product.inStock} />
          <Link
            href="/cart"
            className="inline-flex h-10 w-full items-center justify-center rounded-lg border border-line text-sm font-medium hover:bg-bg"
          >
            查看购物车 / 结算
          </Link>
          <p className="text-xs text-muted">
            下单后跳转收银台完成支付；支付成功卡密自动发放，凭「订单号 + 邮箱 + 查单密码」随时查看。
          </p>
        </div>
      </aside>
    </article>
  );
}
