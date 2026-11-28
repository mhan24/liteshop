import { handlePaymentWebhook } from "@/server/orders";
import { clientIpFromHeaders, rateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 64 * 1024;

// 只有网关可结束重试的结果才应答 success。
export async function POST(request: Request) {
  const declaredLength = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) return plain("fail");
  const limited = rateLimit(`webhook:${clientIpFromHeaders(request.headers)}`, 120, 60_000);
  if (!limited.ok) return plain("fail");

  const reader = request.body?.getReader();
  if (!reader) return plain("fail");
  const decoder = new TextDecoder();
  let bytes = 0;
  let rawBody = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BODY_BYTES) {
        await reader.cancel();
        return plain("fail");
      }
      rawBody += decoder.decode(value, { stream: true });
    }
    rawBody += decoder.decode();
  } catch {
    return plain("fail");
  } finally {
    reader.releaseLock();
  }

  const result = await handlePaymentWebhook("litepay", rawBody);
  return plain(result.respond);
}

function plain(body: "success" | "fail"): Response {
  return new Response(body, {
    status: 200,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}
