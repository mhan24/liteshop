import { hasOrderAccess } from "@/server/order/access";
import { clientIpFromRequest } from "@/server/security/client-ip";
import { checkOrderStatusRateLimit } from "@/server/security/rate-limit";
import { getOrderStatusView } from "@/server/order/query-order";

/** 支付回跳页轮询：受限视图（不含交付内容），取货请走 /orders 双因子查询 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const orderNo = url.searchParams.get("order_no") ?? "";
  const limit = checkOrderStatusRateLimit(clientIpFromRequest(request), orderNo);
  if (!limit.ok) return Response.json({ ok: false, error: "查询过于频繁" }, {
    status: 429, headers: { "Retry-After": String(limit.retryAfterSeconds ?? 60), "Cache-Control": "no-store" },
  });
  // 未授权和不存在统一返回，避免仅凭订单号验证存在性。
  if (!await hasOrderAccess(orderNo)) {
    return Response.json({ ok: false, error: "请凭订单号和邮箱查询" }, { status: 404, headers: { "Cache-Control": "no-store" } });
  }
  const view = getOrderStatusView(orderNo);
  if (!view) {
    return Response.json({ ok: false, error: "订单不存在" }, { status: 404, headers: { "Cache-Control": "no-store" } });
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
      productSlug: view.productSlug,
      // 重购资格由服务端计算，前台按钮直接以此为准
      canRepurchase: view.canRepurchase,
      repurchaseBlockedReason: view.repurchaseBlockedReason,
      // 交易所转账指引：轮询响应必须携带，否则首帧指引会被轮询覆盖抹掉
      transferInstructions: view.transferInstructions,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
