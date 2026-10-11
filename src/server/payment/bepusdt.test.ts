import { afterEach, describe, expect, it, vi } from "vitest";
import { epusdtSign } from "@/lib/signature";
import { bepusdtProvider, parseBepusdtConfig } from "./bepusdt";

/** bepusdt 渠道测试：字段/算法均以网关源码为准（PLAN §5） */

const CONFIG = { api_base: "https://pay.example.com", token: "tok", trade_type: "usdt.trc20", fiat: "CNY" };

describe("parseBepusdtConfig", () => {
  it("缺省值与清洗", () => {
    const c = parseBepusdtConfig({ api_base: "https://a.b/", token: " t " });
    expect(c.apiBase).toBe("https://a.b");
    expect(c.token).toBe("t");
    expect(c.fiat).toBe("CNY");
    expect(c.timeoutSeconds).toBeUndefined();
  });
});

describe("bepusdtProvider.createPayment（收银台模式 create-order）", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("请求体带签名、不传 trade_type（由收银台自选），响应快照正确", async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toBe("https://pay.example.com/api/v1/order/create-order");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      // 网关侧验签逻辑：同算法应通过
      expect(epusdtSign(body, "tok")).toBe(body["signature"]);
      expect(body["order_id"]).toBe("LS20261011TESTTEST");
      expect(body["amount"]).toBe(9.9);
      expect(body["trade_type"]).toBeUndefined();
      return new Response(
        JSON.stringify({
          status_code: 200,
          data: {
            trade_id: "gw_123",
            order_id: "LS20261011TESTTEST",
            amount: 9.9,
            actual_amount: "1.234567",
            status: 1,
            token: "TRXaddr",
            expiration_time: 1780000000,
            payment_url: "https://pay.example.com/checkout/x",
            reselect: true,
          },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const provider = bepusdtProvider(CONFIG);
    const created = await provider.createPayment({
      orderNo: "LS20261011TESTTEST",
      amountCents: 990n,
      currency: "CNY",
      subject: "Demo",
      notifyUrl: "https://shop.example.com/api/pay/notify/bepusdt",
      redirectUrl: "https://shop.example.com/pay/return?order_no=LS20261011TESTTEST",
    });
    expect(created.tradeId).toBe("gw_123");
    expect(created.paymentUrl).toBe("https://pay.example.com/checkout/x");
    expect(created.expectedActualAmount).toBe("1.234567");
    expect(created.expirationTime).toEqual(new Date(1780000000 * 1000));
  });

  it("网关业务失败抛错", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ status_code: 400, message: "余额不足" }), { status: 200 }))
    );
    const provider = bepusdtProvider(CONFIG);
    await expect(
      provider.createPayment({
        orderNo: "LS20261011TESTTEST",
        amountCents: 990n,
        currency: "CNY",
        subject: "Demo",
        notifyUrl: "https://shop.example.com/n",
        redirectUrl: "https://shop.example.com/r",
      })
    ).rejects.toThrow(/创建订单失败/);
  });
});

describe("bepusdtProvider.verifyNotify", () => {
  it("合法回调（网关 EpNotify 字段）通过", () => {
    const provider = bepusdtProvider(CONFIG);
    const body: Record<string, unknown> = {
      trade_id: "gw_123",
      order_id: "LS20261011TESTTEST",
      amount: 9.9, // float64
      actual_amount: "1.234567",
      token: "TRXaddr",
      block_transaction_id: "0xabc",
      status: 2,
    };
    const signed = { ...body, signature: epusdtSign(body, "tok") };
    const v = provider.verifyNotify(JSON.stringify(signed));
    expect(v.ok).toBe(true);
    expect(v.payload?.status).toBe(2);
    expect(v.payload?.amount).toBe(9.9);
    expect(v.payload?.orderNo).toBe("LS20261011TESTTEST");
  });

  it("篡改/换 token 拒绝", () => {
    const provider = bepusdtProvider(CONFIG);
    const body = { order_id: "LS20261011TESTTEST", amount: 9.9, status: 2 };
    const signed = { ...body, signature: epusdtSign(body, "tok") };
    expect(provider.verifyNotify(JSON.stringify({ ...signed, amount: 1 })).ok).toBe(false);
    const other = { ...body, signature: epusdtSign(body, "other") };
    expect(provider.verifyNotify(JSON.stringify(other)).ok).toBe(false);
    expect(provider.verifyNotify("not json").ok).toBe(false);
  });
});
