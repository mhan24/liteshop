import { afterEach, describe, expect, it, vi } from "vitest";
import { litepaySign } from "@/lib/litepay-sign";
import { litepayAdapter } from "@/server/payments/litepay";
import type { GatewayRuntime } from "@/server/payments/types";

/**
 * LitePay 适配器：请求形状、响应分类（created / rejected / unknown）、回调验签。
 * 网络层用 stub 替代，理由是不在测试里访问真实网关。
 */
const gateway: GatewayRuntime = {
  type: "litepay",
  apiBase: "https://pay.test.local",
  token: "tok_123",
  currencies: "USDT,USDC",
  timeoutSeconds: 600,
  reselect: true,
};

const input = {
  orderNo: "LS20260101000000ABCDEF",
  amountCents: 1234,
  subject: "测试商品",
  notifyUrl: "https://shop.test/api/webhooks/litepay",
  redirectUrl: "https://shop.test/pay/LS20260101000000ABCDEF",
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function stubFetch(responder: (url: string, init?: RequestInit) => Response) {
  const mock = vi.fn(async (url: string | URL, init?: RequestInit) => responder(String(url), init));
  vi.stubGlobal("fetch", mock);
  return mock;
}

describe("LitePay 建单", () => {
  it("成功后返回 trade_id、收银台地址与有效期，请求带签名且 fiat 固定 USD", async () => {
    const mock = stubFetch(
      () =>
        new Response(
          JSON.stringify({
            status_code: 200,
            message: "success",
            data: {
              trade_id: "20260101120000ABCDEF",
              payment_url: "https://pay.test.local/pay/20260101120000ABCDEF",
              expiration_time: 300,
              amount: "12.34",
            },
          }),
          { status: 200, headers: { "content-type": "application/json" } }
        )
    );

    const outcome = await litepayAdapter.createPayment(gateway, input);
    expect(outcome.kind).toBe("created");
    if (outcome.kind !== "created") return;
    expect(outcome.payment.providerRef).toBe("20260101120000ABCDEF");
    expect(outcome.payment.paymentUrl).toBe("https://pay.test.local/pay/20260101120000ABCDEF");
    expect(outcome.payment.expiresAt!.getTime()).toBeGreaterThan(Date.now() + 200_000);

    const [url, init] = mock.mock.calls[0]!;
    expect(url).toBe("https://pay.test.local/api/v1/order/create-order");
    const body = JSON.parse(String(init!.body)) as Record<string, unknown>;
    expect(body.amount).toBe(12.34);
    expect(body.fiat).toBe("USD");
    expect(body.timeout).toBe(600);
    expect(body.currencies).toBe("USDT,USDC");
    expect(body.signature).toBe(litepaySign({ ...body, signature: undefined }, "tok_123"));
  });

  it("HTTP 200 + status_code>=400 属于明确拒绝（可安全关单）", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ status_code: 400, message: "signature verification failed" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const outcome = await litepayAdapter.createPayment(gateway, input);
    expect(outcome).toMatchObject({ kind: "rejected" });
  });

  it("网关 5xx / 网络异常归为未知（必须保留订单待对账）", async () => {
    stubFetch(() => new Response("boom", { status: 502 }));
    expect((await litepayAdapter.createPayment(gateway, input)).kind).toBe("unknown");

    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("ECONNRESET"))));
    expect((await litepayAdapter.createPayment(gateway, input)).kind).toBe("unknown");
  });

  it.each([{ expiration_time: 0 }, { expiration_time: 999999999 }, { status: 2 }, { order_id: "other-order" }, { amount: "11.34" }])(
    "网关返回已结束或不符的交易时保留对账：%o", async (fields) => {
      const mock = stubFetch(() => Response.json({ status_code: 200, data: {
        trade_id: "T1", payment_url: "https://pay.test.local/pay/T1", ...fields,
      } }));
      const result = await litepayAdapter.createPayment(gateway, { ...input, subject: "数字商品".repeat(30) });
      expect(result.kind).toBe("unknown");
      const body = JSON.parse(String(mock.mock.calls[0]![1]!.body));
      expect(body.name).toBe(input.orderNo);
    }
  );

  it.each([3, 4])("识别网关终态 %s，核对订单号和金额后保留交易号", async (status) => {
    stubFetch(() => Response.json({ status_code: 200, data: {
      status, trade_id: "T1", order_id: input.orderNo, amount: "12.34", expiration_time: 0,
    } }));
    expect(await litepayAdapter.createPayment(gateway, input)).toMatchObject({ kind: "closed", providerRef: "T1" });
  });

  it.each([
    ["https://checkout.test/pay/T1", "created"],
    ["https://checkout.test/pay/T2", "unknown"],
    ["https://checkout.test/pay/T1?next=other", "unknown"],
    ["https://name@checkout.test/pay/T1", "unknown"],
    ["http://checkout.test/pay/T1", "unknown"],
  ])("核对收银台路径、交易号与协议：%s", async (paymentUrl, kind) => {
    stubFetch(() => Response.json({ status_code: 200, data: {
      trade_id: "T1", payment_url: paymentUrl, expiration_time: 120,
    } }));
    expect((await litepayAdapter.createPayment(gateway, input)).kind).toBe(kind);
  });

  it("金额超出网关受理范围时直接拒绝，不发起请求", async () => {
    const mock = stubFetch(() => new Response("{}", { status: 200 }));
    expect((await litepayAdapter.createPayment(gateway, { ...input, amountCents: 0 })).kind).toBe(
      "rejected"
    );
    expect(
      (await litepayAdapter.createPayment(gateway, { ...input, amountCents: 100_000_000 })).kind
    ).toBe("rejected");
    expect(mock).not.toHaveBeenCalled();
  });
});

describe("LitePay 回调验签", () => {
  function signed(payload: Record<string, unknown>) {
    return JSON.stringify({ ...payload, signature: litepaySign(payload, "tok_123") });
  }

  it("签名正确时解出订单号、交易号与金额", () => {
    const body = signed({
      trade_id: "T1",
      order_id: "LS1",
      amount: 12.34,
      actual_amount: 12.34,
      token: "TReceiverUID",
      block_transaction_id: "999",
      status: 2,
    });
    const result = litepayAdapter.verifyNotify(gateway, body);
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      providerRef: "T1",
      orderNo: "LS1",
      amount: 12.34,
      status: 2,
    });
  });

  it("签名不符或缺签一律拒绝", () => {
    const body = signed({ trade_id: "T1", order_id: "LS1", amount: 1, status: 2 });
    const tampered = JSON.stringify({ ...JSON.parse(body), amount: 100 });
    expect(litepayAdapter.verifyNotify(gateway, tampered).ok).toBe(false);
    expect(
      litepayAdapter.verifyNotify(gateway, JSON.stringify({ trade_id: "T1", order_id: "LS1" })).ok
    ).toBe(false);
  });

  it("忽略未知结构化扩展，不接受非标量业务字段或空白令牌", () => {
    const valid = { trade_id: "T1", order_id: "LS1", amount: 12.34, actual_amount: 12.34, status: 2 };
    const body = JSON.stringify({ ...JSON.parse(signed(valid)), extension: { note: "extra" } });
    expect(litepayAdapter.verifyNotify(gateway, body).ok).toBe(true);
    for (const key of ["trade_id", "order_id", "amount", "actual_amount", "status"]) {
      expect(litepayAdapter.verifyNotify(gateway, signed({ ...valid, [key]: ["2"] })).ok).toBe(false);
    }
    const whitespace = { ...valid, signature: litepaySign(valid, "  ") };
    expect(litepayAdapter.verifyNotify({ ...gateway, token: "  " }, JSON.stringify(whitespace)).ok).toBe(false);
  });

  it("令牌缺失时无法验签", () => {
    const body = signed({ trade_id: "T1", order_id: "LS1", amount: 1, status: 2 });
    expect(litepayAdapter.verifyNotify({ ...gateway, token: null }, body).ok).toBe(false);
  });
});

describe("LitePay 撤销交易", () => {
  it("网关受理时返回 ok", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ status_code: 200, message: "success" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const result = await litepayAdapter.cancelPayment!(gateway, "T1");
    expect(result.ok).toBe(true);
  });

  it("网关业务错误时返回失败并带上原因", async () => {
    stubFetch(
      () =>
        new Response(JSON.stringify({ status_code: 400, message: "trade not found" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        })
    );
    const result = await litepayAdapter.cancelPayment!(gateway, "T1");
    expect(result.ok).toBe(false);
    expect(result.message).toContain("trade not found");
  });
});
