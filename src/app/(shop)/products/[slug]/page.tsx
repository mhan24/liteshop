import type { Metadata } from "next";
import { jsonForScriptTag } from "@/lib/security-headers";
import Link from "next/link";
import { notFound } from "next/navigation";
import { formatMoney } from "@/lib/money";
import { getProductBySlug } from "@/server/catalog";
import { getSiteUrl } from "@/server/settings";
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
  const description = product.description.slice(0, 150) || "卡密商品，付款确认后自动发放。";
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
  const [product, siteUrl] = await Promise.all([getProductBySlug(slug), getSiteUrl()]);
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
      priceCurrency: "USD",
      price: (product.priceCents / 100).toFixed(2),
      availability: product.inStock ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
  };

  return (
    <article className="space-y-14">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonForScriptTag(jsonLd) }} />

      <nav className="text-xs text-muted" aria-label="面包屑">
        <Link href="/" className="hover:text-fg">
          商品
        </Link>
        {product.categorySlug ? (
          <>
            <span className="px-1.5">/</span>
            <Link href={`/?category=${product.categorySlug}`} className="hover:text-fg">
              {product.categoryName}
            </Link>
          </>
        ) : null}
        <span className="px-1.5">/</span>
        <span className="text-fg">{product.name}</span>
      </nav>

      <div className="grid gap-12 lg:grid-cols-[1.25fr_1fr]">
        <section className="space-y-7">
          <header className="space-y-4">
            <h1 className="font-serif text-3xl font-semibold leading-[1.12] tracking-[-0.025em] sm:text-4xl">
              {product.name}
            </h1>
            <p className="font-mono text-xs uppercase tracking-[0.12em] text-muted">
              即时交付 · {product.inStock ? `库存 ${product.stock}` : "暂无库存"}
            </p>
          </header>

          {product.imageUrl ? (
            <div className="overflow-hidden rounded-xl border border-line bg-surface-2">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={product.imageUrl} alt={product.name} className="w-full object-cover" />
            </div>
          ) : null}

          {product.description ? (
            <div className="whitespace-pre-wrap text-sm leading-7 text-muted">{product.description}</div>
          ) : (
            <p className="text-sm leading-7 text-muted">该商品暂未填写介绍，下单后按页面价格交付对应数量的卡密。</p>
          )}

          <section className="space-y-4 border-t border-line pt-7">
            <h2 className="font-serif text-lg font-semibold tracking-[-0.01em]">交付方式</h2>
            <ul className="space-y-2.5 text-sm leading-6 text-muted">
              <li>付款确认后自动发放卡密，不需要等人工处理。</li>
              <li>完成页直接显示内容，同一份内容发送到下单邮箱。</li>
              <li>订单与卡密可用订单号、下单邮箱和查单密码在「订单查询」再次查看。</li>
              <li>数字商品一经发出无法收回，非质量问题不支持退款。</li>
            </ul>
          </section>
        </section>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <div className="space-y-6 rounded-xl border border-line bg-surface p-7">
            <div className="space-y-1.5">
              <p className="font-serif text-3xl font-semibold tracking-[-0.02em]">
                {formatMoney(product.priceCents)}
              </p>
              <p className="text-xs text-muted">
                {product.inStock ? `当前可售 ${product.stock} 件` : "缺货，补货后即可下单"}
              </p>
            </div>

            <AddToCart
              slug={product.slug}
              name={product.name}
              priceCents={product.priceCents}
              inStock={product.inStock}
            />

            <div className="space-y-3 border-t border-line pt-5 text-xs leading-5 text-muted">
              <p>支持 USDT / USDC 付款，走 LitePay 收银台，订单以美元计价。</p>
              <p>下单后会显示一次查单密码，请连同订单号一起保存。</p>
            </div>
          </div>
        </aside>
      </div>
    </article>
  );
}
