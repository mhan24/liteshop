import Link from "next/link";
import { listShopProducts } from "@/server/shop";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { CaretRightIcon, TicketIcon } from "@phosphor-icons/react/ssr";

export const dynamic = "force-dynamic";

export default async function ShopHomePage() {
  const products = listShopProducts();

  return (
    <main className="mx-auto max-w-5xl px-4">
      {/* Hero：编辑式排版，背景用暖色低透明径向光斑增加层次（taste-skill §6） */}
      <section
        className="relative py-24 sm:py-32"
        style={{
          backgroundImage:
            "radial-gradient(600px 240px at 20% 0%, rgba(180,160,120,0.05), transparent)",
        }}
      >
        <Reveal>
          <p className="mb-4 inline-flex items-center rounded-full border border-border bg-card px-3 py-1 text-xs tracking-[0.05em] text-muted-foreground uppercase">
            数字商品 · 支付后自动发货
          </p>
          <h1 className="max-w-2xl font-serif text-4xl leading-[1.1] tracking-tight sm:text-5xl">
            挑选商品，
            <br />
            卡密秒到。
          </h1>
          <p className="mt-4 max-w-xl text-[15px] leading-relaxed text-muted-foreground">
            下单后跳转收银台使用 USDT 等加密货币支付，
            到账即自动发放卡密；人工商品由客服快速处理。
          </p>
        </Reveal>
      </section>

      {/* 商品网格 */}
      <section className="pb-24">
        {products.length === 0 ? (
          <Reveal className="rounded-xl border border-border bg-card p-16 text-center">
            <p className="font-serif text-xl">商品上架中</p>
            <p className="mt-2 text-sm text-muted-foreground">敬请期待</p>
          </Reveal>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {products.map((p, i) => (
              <Reveal key={p.id} delay={i}>
                <Link
                  href={`/products/${p.slug}`}
                  className="card-hover group flex h-full flex-col rounded-xl border border-border bg-card p-6 transition-transform"
                >
                  {p.imageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={p.imageUrl}
                      alt={p.name}
                      className="mb-4 aspect-[2/1] w-full rounded-lg border border-border object-cover"
                    />
                  ) : null}
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-medium leading-snug">{p.name}</h2>
                    <Badge
                      className={
                        p.deliveryType === "auto"
                          ? "bg-pastel-green-bg text-pastel-green-text"
                          : "bg-pastel-blue-bg text-pastel-blue-text"
                      }
                    >
                      {p.deliveryType === "auto" ? "自动发卡" : "人工发货"}
                    </Badge>
                  </div>
                  {p.description ? (
                    <p className="mt-2 line-clamp-2 text-sm leading-relaxed text-muted-foreground">
                      {p.description}
                    </p>
                  ) : null}
                  <div className="mt-auto flex items-center justify-between pt-6">
                    <span className="font-mono text-lg">
                      <span className="mr-1 text-xs text-muted-foreground">{p.currency}</span>
                      {p.priceFormatted}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 text-sm transition-colors ${
                        p.onSale
                          ? "text-foreground group-hover:text-foreground"
                          : "text-muted-foreground"
                      }`}
                    >
                      {p.onSale ? (
                        p.stock != null && p.stock <= 5 ? (
                          `余 ${p.stock}`
                        ) : (
                          "立即购买"
                        )
                      ) : (
                        "暂时售罄"
                      )}
                      {p.onSale ? (
                        <CaretRightIcon className="size-3.5 transition-transform group-hover:translate-x-0.5" weight="bold" />
                      ) : (
                        <TicketIcon className="size-3.5" weight="bold" />
                      )}
                    </span>
                  </div>
                </Link>
              </Reveal>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
