import { getOrderStatusView } from "@/server/order/query-order";
import { getCopy } from "@/server/copy";
import { getTurnstileClientConfig } from "@/server/settings";
import { OrderStatusPoll } from "@/components/shop/order-status-poll";

export const dynamic = "force-dynamic";
export const metadata = { title: "待支付订单" };

/**
 * 待支付页：下单后先落地在此，从收银台回退/误关后仍可继续支付。
 * 支付地址复用订单快照（未过期不轮换 trade_id）；过期可在本页重新发起。
 */
export default async function PayPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ order_no?: string }>;
}) {
  const { order_no: orderNo } = await searchParams;
  const view = orderNo ? getOrderStatusView(orderNo) : null;
  const pendingHint = getCopy("pending_hint");
  // 重新购买同样会创建订单，需与商品页一致地下发人机验证配置
  const turnstile = getTurnstileClientConfig();

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
        turnstile={turnstile}
        payCTA
        initial={
          view
            ? {
                orderNo: view.orderNo,
                status: view.status,
                statusLabel: view.statusLabel,
                productName: view.productName,
                quantity: view.quantity,
                total: view.totalFormatted,
                emailMasked: view.emailMasked,
                paymentUrl: view.paymentUrl,
                expiresAtText: view.expiresAtText,
                productSlug: view.productSlug,
              }
            : null
        }
      />
      {view?.status === "pending" ? (
        <p className="mt-4 px-1 text-xs leading-relaxed text-muted-foreground">
          {pendingHint}
        </p>
      ) : null}
    </main>
  );
}
