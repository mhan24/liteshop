import { getOrderStatusView } from "@/server/order/query-order";
import { OrderStatusPoll } from "@/components/shop/order-status-poll";

export const dynamic = "force-dynamic";
export const metadata = { title: "订单状态" };

export default async function PayReturnPage({
  searchParams,
}: {
  searchParams: Promise<{ order_no?: string }>;
}) {
  const { order_no: orderNo } = await searchParams;
  const order = orderNo ? getOrderStatusView(orderNo) : null;

  return (
    <main
      className="mx-auto max-w-2xl px-4 py-20"
      style={{
        backgroundImage:
          "radial-gradient(500px 200px at 80% 0%, rgba(180,160,120,0.05), transparent)",
      }}
    >
      <OrderStatusPoll orderNo={orderNo ?? ""} payCTA initial={order ? {
        orderNo: order.orderNo,
        status: order.status,
        statusLabel: order.statusLabel,
        productName: order.productName,
        quantity: order.quantity,
        total: order.totalFormatted,
        emailMasked: order.emailMasked,
        paymentUrl: order.paymentUrl,
        expiresAtText: order.expiresAtText,
      } : null} />
    </main>
  );
}
