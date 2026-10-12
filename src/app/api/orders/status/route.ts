import { getOrderStatusView } from "@/server/order/query-order";

/** 支付回跳页轮询：受限视图（不含交付内容），取货请走 /orders 双因子查询 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderNo = url.searchParams.get("order_no") ?? "";
  const view = getOrderStatusView(orderNo);
  if (!view) {
    return Response.json({ ok: false, error: "订单不存在" }, { status: 404 });
  }
  return Response.json({
    ok: true,
    order: {
      orderNo: view.orderNo,
      status: view.status,
      statusLabel: view.statusLabel,
      productName: view.productName,
      quantity: view.quantity,
      total: view.totalFormatted,
      emailMasked: view.emailMasked,
      paymentUrl: view.paymentUrl,
      expiresAtText: view.expiresAtText,
    },
  });
}
