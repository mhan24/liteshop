"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getMockCheckoutData } from "@/server/order/query-order";
import { buildMockNotifyBody } from "@/server/payment/mock";

/** mock 收银台：构造带签名的回调报文 POST 到本站 notify 端点（走真实 HTTP 链路） */
export async function mockPayAction(formData: FormData): Promise<void> {
  const orderNo = String(formData.get("orderNo") ?? "");
  const outcome = String(formData.get("outcome") ?? "2");

  const order = getMockCheckoutData(orderNo);
  if (!order || order.status !== "pending" || !order.tradeId) {
    redirect(`/pay/return?order_no=${encodeURIComponent(orderNo)}`);
  }

  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");

  const body = buildMockNotifyBody({
    orderNo,
    tradeId: order.tradeId,
    amountCents: order.amountCents,
    status: outcome === "3" ? 3 : 2,
  });

  await fetch(`${proto}://${host}/api/pay/notify/mock`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
    signal: AbortSignal.timeout(10_000),
  }).catch(() => undefined);

  redirect(`/pay/return?order_no=${encodeURIComponent(orderNo)}`);
}
