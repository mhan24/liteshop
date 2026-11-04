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

  return (
    <div className="space-y-20">
      <section className="relative px-2 pt-6 pb-2 sm:pt-10">
        <div
          aria-hidden
          className="pointer-events-none absolute left-1/2 top-0 h-72 w-[34rem] max-w-full -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(17,17,17,0.035),transparent)]"
        />
        <p className="text-xs uppercase tracking-[0.22em] text-muted">数字卡密 · 自动发货</p>
        <h1 className="mt-5 max-w-2xl font-serif text-4xl font-semibold leading-[1.08] tracking-[-0.03em] sm:text-5xl">
          付款确认后，卡密自动发到你的邮箱。
        </h1>
        <p className="mt-6 max-w-xl text-sm leading-7 text-muted">
          下单时填好邮箱，系统在收到支付确认后立即分配卡密。之后凭订单号、邮箱和查单密码，可以再查到同一份内容。
        </p>

        <form action="/" className="mt-9 flex max-w-md gap-2">
          <input
            name="q"
            defaultValue={q ?? ""}
            placeholder="搜索商品名称"
            aria-label="搜索商品"
            className="h-11 flex-1 rounded-md border border-line bg-surface px-3.5 text-sm placeholder:text-muted/60 focus:border-fg"
          />
          {category ? <input type="hidden" name="category" value={category} /> : null}
          <button
            type="submit"
            className="h-11 rounded-md bg-accent px-5 text-sm font-medium text-accent-fg transition-colors hover:bg-accent-hover active:scale-[0.98]"
          >
            搜索
          </button>
        </form>
      </section>

      <section className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-line pb-4">
          <h2 className="font-serif text-xl font-semibold tracking-[-0.01em]">全部商品</h2>
          <p className="font-mono text-xs text-muted">{items.length} 件在售</p>
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
          <div className="space-y-2 rounded-xl border border-line bg-surface px-6 py-16 text-center">
            <p className="font-serif text-lg">没有符合条件的商品</p>
            <p className="text-sm text-muted">换个关键词，或者去掉分类筛选再看。</p>
            {q || category ? (
              <p className="pt-3">
                <Link
                  href="/"
                  className="text-sm text-fg underline decoration-line underline-offset-4 hover:decoration-fg"
                >
                  清除筛选条件
                </Link>
              </p>
            ) : null}
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((p, i) => (
              <li key={p.slug}>
                <Reveal index={i % 6}>
                  <ProductCard product={p} />
                </Reveal>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="space-y-8">
        <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
          <h2 className="font-serif text-xl font-semibold tracking-[-0.01em]">购买流程</h2>
          <span className="font-mono text-xs text-muted">三步</span>
        </div>
        <ol className="grid gap-px overflow-hidden rounded-xl border border-line bg-line sm:grid-cols-3">
          {STEPS.map((s, i) => (
            <li key={s.title} className="space-y-3 bg-surface p-7">
              <span className="font-mono text-xs text-muted">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="font-serif text-base font-semibold">{s.title}</h3>
              <p className="text-sm leading-6 text-muted">{s.body}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="space-y-2" id="faq">
        <div className="flex items-baseline justify-between gap-4 border-b border-line pb-4">
          <h2 className="font-serif text-xl font-semibold tracking-[-0.01em]">常见问题</h2>
          <span className="font-mono text-xs text-muted">6 条</span>
        </div>
        <div className="divide-y divide-line">
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
