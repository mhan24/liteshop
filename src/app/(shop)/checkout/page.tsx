import type { Metadata } from "next";
import { listEnabledChannels } from "@/server/payments";
import { getSiteCurrency, getTurnstileClientConfig } from "@/server/settings";
import { CheckoutClient } from "@/components/shop/checkout-client";

export const metadata: Metadata = {
  title: "结算",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const [channels, currency, human] = await Promise.all([
    listEnabledChannels(),
    getSiteCurrency(),
    getTurnstileClientConfig(),
  ]);
  return (
    <div className="space-y-6">
      <h1 className="font-serif text-2xl font-semibold tracking-[-0.02em]">结算</h1>
      <CheckoutClient
        currency={currency}
        channels={channels.map((c) => ({ key: c.key, displayName: c.displayName }))}
        human={human}
      />
    </div>
  );
}
