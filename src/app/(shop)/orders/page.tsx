import { getTurnstileClientConfig } from "@/server/settings";
import { getCopy } from "@/server/copy";
import { OrderLookupClient } from "@/components/shop/order-lookup";
import { Reveal } from "@/components/reveal";

export const dynamic = "force-dynamic";
export const metadata = { title: "订单查询" };

export default async function OrderLookupPage() {
  const turnstile = getTurnstileClientConfig();
  const copy = { title: getCopy("lookup_title"), desc: getCopy("lookup_desc") };

  return (
    <main className="mx-auto max-w-2xl px-4 py-20">
      <Reveal>
        <h1 className="font-serif text-3xl tracking-tight">{copy.title}</h1>
        <p className="mt-2 text-sm text-muted-foreground whitespace-pre-line">{copy.desc}</p>
      </Reveal>

      <Reveal delay={1} className="mt-8">
        <OrderLookupClient turnstile={turnstile.enabled ? turnstile : undefined} />
      </Reveal>
    </main>
  );
}
