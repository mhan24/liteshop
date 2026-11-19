import type { Metadata } from "next";
import { getGatewayStatus } from "@/server/payments";
import { getTurnstileClientConfig } from "@/server/settings";
import { CheckoutClient } from "@/components/shop/checkout-client";

export const metadata: Metadata = {
  title: "结算",
  robots: { index: false, follow: false },
};

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  const [gateway, human] = await Promise.all([getGatewayStatus(), getTurnstileClientConfig()]);
  return (
    <div className="mx-auto max-w-4xl space-y-8">
      <header className="space-y-2 border-b border-line pb-6">
        <p className="eyebrow">结算</p>
        <h1 className="text-3xl font-semibold tracking-[-0.025em]">确认订单并付款</h1>
      </header>
      <CheckoutClient human={human} gatewayReady={gateway.ready} />
    </div>
  );
}
