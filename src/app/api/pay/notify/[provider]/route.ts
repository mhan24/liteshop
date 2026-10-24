import { after } from "next/server";
import { isKnownProvider } from "@/server/payment";
import { handlePaymentNotify } from "@/server/order/fulfill-order";
import { sendOrderEmail } from "@/server/mail";
import { clientIpFromRequest } from "@/server/security/client-ip";
import {
  checkNotifyRateLimit,
  recordRejectedNotify,
  getNotifyRejectStats,
} from "@/server/security/rate-limit";

/**
 * 支付回调统一入口（POST /api/pay/notify/[provider]）。
 *
 * 应答语义（**关键**）：网关把 "success" 视为「商户已接收并处理完毕」。
 * 因此**只要没有真正处理，就绝不能回 success**，否则网关停止重试，
 * 会造成「买家已付款、商店仍显示待支付」的静默丢单。
 *
 * 应答规则：
 * - 已处理，或**确定性**永久失败（验签不过/金额不符/缺少 trade_id 等）
 *   → "success"：重试无意义，终止重试。
 * - 可重试失败（卡池临时不足、DB 忙）
 *   → "fail"：让网关按退避重试，补货后自动完成。
 * - **未能处理**（限流、报文过大、内部异常）
 *   → "fail"：必须让网关重试，不得伪装成功。
 *
 * 防刷与「不漏单」的平衡：限流只用来保护写库，不能用来决定是否确认收款。
 * 因此限流命中回 fail（网关会重试），并单独计数以便观测。
 *
 * 所有渠道统一应答 HTTP 200 + 文本 "success"/"fail"：
 * BEpusdt 协议（bepusdt / litepay，LitePay 2026-10 起提供 BEpusdt 兼容接口）
 * 按**正文**判定——success/ok 终止重试，明确 fail 判为投递失败并重试。
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;
  if (!isKnownProvider(provider)) {
    return new Response("not found", { status: 404 });
  }

  const ip = clientIpFromRequest(request);

  // 报文大小：先判长度再读取，避免超大 body 占用内存
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) {
    // 明确畸形报文：重试也不会变好，但**不能**断言交易无效，
    // 因为可能是网关侧编码问题。回 fail 让其重试，人工可观测。
    return plain("fail");
  }

  const limited = checkNotifyRateLimit(ip);
  if (!limited.ok) {
    // 限流：**不是**「已处理」。必须让网关重试，否则会静默丢单。
    recordRejectedNotify(ip);
    console.warn(
      `[notify-ratelimited] ip=${ip} provider=${provider} retryAfter=${limited.retryAfterSeconds}s stats=${JSON.stringify(getNotifyRejectStats())}`
    );
    return plain("fail");
  }

  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) {
    return plain("fail");
  }

  let result;
  try {
    result = handlePaymentNotify(provider, rawBody, request.headers);
  } catch (err) {
    // 内部异常（如 DB 忙）：交易状态未知，必须让网关重试而不是当作成功
    console.error("[notify-error]", provider, err);
    return plain("fail");
  }

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
  return plain(respondSuccess ? "success" : "fail");
}

function plain(body: "success" | "fail", status = 200): Response {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
