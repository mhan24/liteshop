import { after } from "next/server";
import { isKnownProvider } from "@/server/payment";
import { handlePaymentNotify } from "@/server/order/fulfill-order";
import { sendOrderEmail } from "@/server/mail";
import { checkNotifyRateLimit } from "@/server/security/rate-limit";

/**
 * 支付回调统一入口（POST /api/pay/notify/[provider]）。
 * 应答策略（PLAN §5）：
 * - 已处理（或永久性失败）→ "success"，渠道停止重试
 * - 可重试失败（如卡池临时不足）→ "fail"，渠道按退避策略重试（补货后自动完成发货）
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isKnownProvider(provider)) {
    return new Response("not found", { status: 404 });
  }
  // 未认证端点限流：验签失败的请求也会写库（对账需要），
  // 不限速时可被刷爆日志表与磁盘。
  const fwd = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = fwd || request.headers.get("x-real-ip") || "-";
  const limited = checkNotifyRateLimit(ip);
  if (!limited.ok) {
    // 应答 success 让渠道停止重试，避免放大
    return new Response("success", { status: 200 });
  }

  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) {
    // 异常报文直接终止重试
    return new Response("success", { status: 200 });
  }
  const result = handlePaymentNotify(provider, rawBody);

  // 事务已提交、已确认入账 → 响应后发送买家通知邮件（不阻塞应答）
  if (result.handled && result.emailKind && result.orderNo) {
    const orderNo = result.orderNo;
    const kind = result.emailKind;
    after(async () => {
      try {
        await sendOrderEmail(orderNo, kind);
      } catch (err) {
        console.error("[notify-mail]", orderNo, err);
      }
    });
  }

  const respondSuccess = result.handled || !result.retryable;
  return new Response(respondSuccess ? "success" : "fail", {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
