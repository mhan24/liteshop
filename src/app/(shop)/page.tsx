import Link from "next/link";
import type { Metadata } from "next";
import { listCategories, listStoreProducts } from "@/server/catalog";
import { ProductCard } from "@/components/shop/product-card";
import { Reveal } from "@/components/shop/reveal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数字卡密商店",
  description: "数字卡密商品，付款确认后自动发放，凭订单号、邮箱和查单密码可随时查看。",
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    title: "选商品",
    body: "挑选商品和数量加入购物车，价格与库存实时更新。",
  },
  {
    title: "付款",
    body: "填写下单邮箱并提交，在 LitePay 收银台使用 USDT 或 USDC 付款。超时未付会自动关闭订单，卡密退回库存。",
  },
  {
    title: "收卡密",
    body: "付款确认后，可在「订单查询」查看卡密。查单密码仅在下单后显示一次，请妥善保存。",
  },
] as const;

const FAQ = [
  {
    q: "付款后多久拿到卡密？",
    a: "收款确认后立即发放，通常只需几秒。如果收银台已显示支付成功、订单页仍为待支付，请稍等几秒刷新；超过 10 分钟仍未更新，请先在「订单查询」确认，或联系客服核对。",
  },
  {
    q: "卡密在哪里查看？",
    a: "打开「订单查询」，填写订单号、下单邮箱和查单密码。商店启用邮件通知时，卡密也会发送到下单邮箱。",
  },
  {
    q: "查单密码忘了怎么办？",
    a: "请联系客服，提供订单号和付款记录，核对后可协助找回。",
  },
  {
    q: "用什么付款？",
    a: "通过 LitePay 收银台付款，支持币安、OKX 站内转账的 USDT 与 USDC，订单以美元（USD）计价。",
  },
  {
    q: "可以退款吗？",
    a: "卡密一经发出无法收回，非商品质量问题不支持退款。如已付款但未收到卡密，请联系客服，核对付款记录后补发。",
  },
  {
    q: "订单关闭了怎么办？",
    a: "超时未付款的订单会自动关闭，占用的卡密同步退回库存，重新下单即可。",
  },
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; category?: string | string[] }>;
}) {
  const params = await searchParams;
  const q = Array.isArray(params.q) ? params.q[0] : params.q;
  const category = Array.isArray(params.category) ? params.category[0] : params.category;
  const [items, cats] = await Promise.all([
    listStoreProducts({ q, categorySlug: category }),
    listCategories(),
  ]);
  const activeCat = category ?? "";

  const inStockCount = items.filter((p) => p.inStock).length;

  return (
    <div className="space-y-14 sm:space-y-20">
      <section className="relative -mx-4 -mt-12 overflow-hidden px-4 pt-14 pb-4 sm:-mx-6 sm:-mt-16 sm:px-6 sm:pt-20">
        <div aria-hidden className="hero-backdrop pointer-events-none absolute inset-0" />
        <div className="relative max-w-2xl">
          <p className="eyebrow inline-flex items-center gap-2">
            <span className="live-dot text-accent" />
            数字卡密 · 自动发货
          </p>
          <h1 className="mt-5 text-[32px] font-semibold leading-[1.1] tracking-[-0.02em] sm:text-[40px]">
            付款确认后，
            <br className="sm:hidden" />
            卡密<span className="text-accent">自动</span>发放。
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-7 text-muted">
            下单后请保存订单号和查单密码。付款完成后，凭这两项和下单邮箱即可在「订单查询」查看卡密。
          </p>

          <form action="/" className="mt-8 flex max-w-md gap-2" role="search">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="搜索商品名称或简介"
              aria-label="搜索商品"
              className="h-11 flex-1 rounded-sm border border-line-strong bg-surface-2 px-3.5 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-faint focus:border-accent focus:ring-[3px] focus:ring-accent/20"
            />
            {category ? <input type="hidden" name="category" value={category} /> : null}
            <button
              type="submit"
              className="h-11 rounded-sm bg-accent px-5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
            >
              搜索
            </button>
          </form>

          <dl className="mt-10 flex flex-wrap gap-x-8 gap-y-3 text-xs text-faint">
            {[
              ["在售", `${inStockCount}`],
              ["付款", "USDT / USDC"],
              ["发货", "支付确认即发"],
            ].map(([k, v]) => (
              <div key={k} className="flex items-baseline gap-2">
                <dt>{k}</dt>
                <dd className="data text-[13px] text-fg">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      <section className="space-y-6" aria-labelledby="products-heading">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1.5">
            <p className="eyebrow">{"// 商品"}</p>
            <h2 id="products-heading" className="text-lg font-semibold tracking-[-0.01em]">
              全部商品
            </h2>
          </div>
          <p className="data text-xs text-faint">{items.length} 件</p>
        </div>

        {cats.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            <Link href="/" className="chip" data-active={activeCat === ""}>
              全部
            </Link>
            {cats.map((c) => (
              <Link
                key={c.id}
                href={`/?category=${c.slug}`}
                className="chip"
                data-active={activeCat === c.slug}
              >
                {c.name}
              </Link>
            ))}
          </div>
        ) : null}

        {items.length === 0 ? (
          <div className="space-y-2 rounded-md border border-dashed border-line-strong px-6 py-16 text-center">
            <p className="text-base font-medium">没有找到相关商品</p>
            <p className="text-sm text-muted">请尝试更换关键词，或清除分类筛选。</p>
            {q || category ? (
              <p className="pt-3">
                <Link href="/" className="text-sm text-accent underline-offset-4 hover:underline">
                  清除筛选条件
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p, i) => (
              <li key={p.slug}>
                <Reveal index={i % 6} className="h-full">
                  <ProductCard product={p} />
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-6" aria-labelledby="steps-heading">
        <div className="space-y-1.5">
          <p className="eyebrow">{"// 流程"}</p>
          <h2 id="steps-heading" className="text-lg font-semibold tracking-[-0.01em]">
            购买流程
          </h2>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-md border border-line bg-line sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="space-y-3 bg-surface p-6 sm:p-7">
              <span className="data text-xs text-accent">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-[15px] font-semibold">{s.title}</h3>
              <p className="text-sm leading-6 text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="grid gap-6 lg:grid-cols-[16rem_1fr] lg:gap-12" id="faq" aria-labelledby="faq-heading">
        <div className="space-y-1.5">
          <p className="eyebrow">{"// 常见问题"}</p>
          <h2 id="faq-heading" className="text-lg font-semibold tracking-[-0.01em]">
            购买前须知
          </h2>
        </div>
        <div className="divide-y divide-line border-y border-line">
          {FAQ.map((item) => (
            <details key={item.q} className="faq-item">
              <summary>{item.q}</summary>
              <div className="faq-answer">{item.a}</div>
            </details>
          ))}
        </div>
      </section>
    </div>
  );
}
