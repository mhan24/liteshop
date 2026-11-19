import Link from "next/link";
import type { Metadata } from "next";
import { listCategories, listStoreProducts } from "@/server/catalog";
import { ProductCard } from "@/components/shop/product-card";
import { Reveal } from "@/components/shop/reveal";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "数字卡密商店",
  description: "卡密商品，付款确认后自动发放并发送到下单邮箱；凭订单号、邮箱与查单密码可再次查看。",
  alternates: { canonical: "/" },
};

const STEPS = [
  {
    title: "选商品",
    body: "挑好商品和数量，加入购物车。价格与库存都是实时的。",
  },
  {
    title: "付款",
    body: "填下单邮箱后提交订单，在 LitePay 收银台用 USDT 或 USDC 转账。订单有支付时限，超时自动关闭并把卡密退回库存。",
  },
  {
    title: "收卡密",
    body: "支付确认后自动发放：完成页立即显示，同一份内容也发到下单邮箱。查单密码只在建单时显示一次。",
  },
] as const;

const FAQ = [
  {
    q: "付款后多久拿到卡密？",
    a: "网关确认付款后立即发放，通常只需要几秒。如果收银台已显示支付成功、这里仍是待支付，等几秒刷新；超过十分钟仍未更新，请到订单查询页确认，或联系客服核对。",
  },
  {
    q: "卡密在哪里查看？",
    a: "三个地方：支付完成页、订单查询页（需要订单号、下单邮箱和查单密码）、下单时填写的邮箱。邮箱没收到就检查垃圾邮件目录。",
  },
  {
    q: "查单密码忘了怎么办？",
    a: "联系客服，提供订单号和付款记录，核对后可以协助找回订单内容。",
  },
  {
    q: "用什么付款？",
    a: "收银台走 LitePay，支持币安、OKX 站内转账的 USDT 与 USDC。订单以美元计价。",
  },
  {
    q: "可以退款吗？",
    a: "卡密发出后无法收回，非质量问题不支持退款。付款后没收到卡密请联系客服，我们按付款记录核对后补发。",
  },
  {
    q: "订单关闭了怎么办？",
    a: "超时未付款的订单会自动关闭，占用的卡密同时退回库存。重新下单即可。",
  },
] as const;

export default async function HomePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; category?: string }>;
}) {
  const { q, category } = await searchParams;
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
            卡密<span className="text-accent">自动</span>发到你的邮箱。
          </h1>
          <p className="mt-5 max-w-xl text-[15px] leading-7 text-muted">
            下单时填好邮箱，系统在收到支付确认后立即分配卡密。之后凭订单号、邮箱和查单密码，可以再查到同一份内容。
          </p>

          <form action="/" className="mt-8 flex max-w-md gap-2" role="search">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="搜索商品名称"
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
            <p className="text-base font-medium">没有符合条件的商品</p>
            <p className="text-sm text-muted">换个关键词，或者去掉分类筛选再看。</p>
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
            三步拿到卡密
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
            付款前想知道的
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
