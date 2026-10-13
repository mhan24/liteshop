import { hasOrderAccess } from "@/server/order/access";
import { getOrderStatusView } from "@/server/order/query-order";
import { getSupportUrl, getTurnstileClientConfig } from "@/server/settings";
import { getCopy } from "@/server/copy";
import { OrderStatusPoll } from "@/components/shop/order-status-poll";

export const dynamic = "force-dynamic";
export const metadata = { title: "订单状态" };

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order_no?: string }>;
}) {
  const { order_no: orderNo } = await searchParams;
  const order = orderNo && await hasOrderAccess(orderNo) ? getOrderStatusView(orderNo) : null;
  // 本页同样启用 payCTA（可重新购买），因此必须与待支付页保持一致：
  // 下发人机验证配置 + 服务端计算的重购资格。
  // 否则开启 Turnstile 后此处重购会因缺少 cfToken 被服务端守卫拒绝。
  const turnstile = getTurnstileClientConfig();
  const support = { url: getSupportUrl(), label: getCopy("support_label") };

  return (
    <main
      className="mx-auto max-w-2xl px-4 py-20"
      style={{
        backgroundImage:
          "radial-gradient(500px 200px at 80% 0%, rgba(180,160,120,0.05), transparent)",
      }}
    >
      <OrderStatusPoll
        orderNo={orderNo ?? ""}
        payCTA
        turnstile={turnstile}
        support={support}
        initial={order ? {
          orderNo: order.orderNo,
          status: order.status,
          statusLabel: order.statusLabel,
          productName: order.productName,
          quantity: order.quantity,
          total: order.totalFormatted,
          emailMasked: order.emailMasked,
          paymentUrl: order.paymentUrl,
          expiresAtText: order.expiresAtText,
          productSlug: order.productSlug,
          canRepurchase: order.canRepurchase,
          repurchaseBlockedReason: order.repurchaseBlockedReason,
          transferInstructions: order.transferInstructions,
        } : null}
      />
    </main>
  );
}
