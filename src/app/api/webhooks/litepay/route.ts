import { handlePaymentWebhook } from "@/server/orders";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

/**
 * LitePay 支付回调（POST /api/webhooks/litepay）。
 *
 * 应答语义：HTTP 2xx + 正文 "success" 表示已处理或确定性终态；正文 "fail"
 * 触发网关按间隔重试（仅用于临时故障，如数据库忙）。
 * 验签失败同样回 success 终止无意义重试（攻击面不落库，仅内存计数）。
 */
export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > 64 * 1024) return plain("fail");
  const limited = rateLimit(`webhook:${clientIpFromHeaders(request.headers)}`, 120, 60_000);
  if (!limited.ok) return plain("fail");

  const rawBody = await request.text();
  if (rawBody.length > 64 * 1024) return plain("fail");

  const result = await handlePaymentWebhook("litepay", rawBody);
  return plain(result.respond);
}

function plain(body: "success" | "fail"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
