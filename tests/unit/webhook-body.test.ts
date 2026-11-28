import { expect, it, vi } from "vitest";
import { POST } from "@/app/api/webhooks/litepay/route";
import { handlePaymentWebhook } from "@/server/orders";

vi.mock("@/server/orders", () => ({
  handlePaymentWebhook: vi.fn(async () => ({ respond: "success" })),
}));

function streamed(chunks: Uint8Array[]) {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    },
  });
  return new Request("http://localhost/api/webhooks/litepay", {
    method: "POST", body, duplex: "half",
  } as RequestInit);
}

it("按 UTF-8 字节限制正文，分块时正确还原字符", async () => {
  const data = new TextEncoder().encode("支付");
  const response = await POST(streamed([data.slice(0, 1), data.slice(1)]));
  expect(await response.text()).toBe("success");
  expect(handlePaymentWebhook).toHaveBeenCalledWith("litepay", "支付");

  vi.mocked(handlePaymentWebhook).mockClear();
  const wide = new TextEncoder().encode("付".repeat(22_000));
  expect(await (await POST(streamed([wide]))).text()).toBe("fail");
  expect(handlePaymentWebhook).not.toHaveBeenCalled();
});
