import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getShopProduct } from "@/server/shop";
import { getCopy } from "@/server/copy";
import { getTurnstileClientConfig } from "@/server/settings";
import { BuyForm, type CheckoutOption } from "@/components/shop/buy-form";
import { listCheckoutMethods } from "@/server/payment";
import { Reveal } from "@/components/reveal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const product = getShopProduct(slug);
  return { title: product?.name ?? "商品" };
}

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const product = getShopProduct(slug);
  if (!product) notFound();

  const turnstile = getTurnstileClientConfig();
  // 支付方式由服务端判定：只有配置完整的渠道才对买家可见，
  // 避免"选了却付不了"。
  const checkoutOptions: CheckoutOption[] = listCheckoutMethods().map((m) =>
    m === "litepay"
      ? {
          value: m,
          label: "交易所转账（USDT / USDC）",
          hint: "按页面给出的收款地址与精确金额转账，到账后自动发货",
        }
      : { value: m, label: "在线支付", hint: "跳转收银台完成支付" }
  );
  const copy = { payHint: getCopy("detail_pay_hint") };
  const soldOut = !product.onSale;
  const maxQuantity =
    product.deliveryType === "auto" || (product.stock != null && product.stock > 0)
      ? Math.min(product.stock ?? 10, 10)
      : 1;

  return (
    <main className="mx-auto max-w-5xl px-4 py-16">
      <Reveal className="grid gap-10 lg:grid-cols-[1.2fr_1fr]">
        {/* 商品信息 */}
        <section>
          {product.imageUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.imageUrl}
              alt={product.name}
              className="mb-8 aspect-[2/1] w-full rounded-xl border border-border object-cover"
            />
          ) : null}
          <div className="flex items-center gap-3">
            <h1 className="font-serif text-3xl tracking-tight sm:text-4xl">{product.name}</h1>
            <Badge
              className={
                product.deliveryType === "auto"
                  ? "bg-pastel-green-bg text-pastel-green-text"
                  : "bg-pastel-blue-bg text-pastel-blue-text"
              }
            >
              {product.deliveryType === "auto" ? "自动发卡" : "人工发货"}
            </Badge>
          </div>
          <p className="mt-4 font-mono text-2xl">{product.priceFormatted}</p>
          <Separator className="my-6" />
          <div className="whitespace-pre-line text-[15px] leading-relaxed text-foreground/90">
            {product.description || "暂无介绍"}
          </div>
        </section>

        {/* 购买卡片 */}
        <section className="lg:sticky lg:top-8 lg:self-start">
          <Card className="border-border bg-card">
            <CardContent className="p-6">
              <div className="mb-5 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">库存</span>
                {soldOut ? (
                  <span className="text-pastel-red-text">暂时售罄</span>
                ) : product.stock != null ? (
                  <span className="font-mono">{product.stock}</span>
                ) : (
                  <span className="text-pastel-green-text">现货</span>
                )}
              </div>
              {soldOut ? (
                <Button className="w-full" size="lg" disabled>
                  暂时售罄
                </Button>
              ) : (
                <BuyForm
                  slug={product.slug}
                  maxQuantity={maxQuantity}
                  deliveryType={product.deliveryType}
                  turnstile={turnstile}
                  methods={checkoutOptions}
                  productName={product.name}
                  total={product.priceFormatted}
                  buttonText={getCopy("buy_button")}
                  notice={getCopy("buy_notice")}
                />
              )}
            </CardContent>
          </Card>
          <p className="mt-4 px-1 text-xs leading-relaxed text-muted-foreground">
            {copy.payHint}
          </p>
        </section>
      </Reveal>
    </main>
  );
}
