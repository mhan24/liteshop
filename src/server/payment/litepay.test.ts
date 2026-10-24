import { afterEach, describe, expect, it, vi } from "vitest";
import { epusdtSign } from "@/lib/signature";
import { litepayProvider, parseLitepayPaymentTarget } from "./litepay";

/**
 * litepay 渠道（pay.9527.tr，BEpusdt 兼容接口）测试。
 *
 * 2026-10 重构后，协议实现与 bepusdt 渠道共享（同签名 / create-order /
 * cancel-transaction / 通知语义），那里已有逐字对齐网关的契约测试。
 * 这里聚焦本渠道的包装行为：
 *   - 渠道名保持 "litepay"（回调路由 /api/pay/notify/litepay、支付尝试归属）
 *   - CreatedPayment 与 NotifyPayload 必须携带 provider="litepay"
 *   - 配置键与 bepusdt 相同（api_base / token / currencies / reselect / timeout_seconds）
 *   - parseLitepayPaymentTarget 继续解析旧版订单快照（/pay/address 历史页面）
 */

const API_BASE = "https://pay.9527.tr";
const TOKEN = "tok";

function provider(config: Record<string, unknown> = {}) {
  return litepayProvider({ api_base: API_BASE, token: TOKEN, ...config });
}

function input(overrides: Partial<Parameters<ReturnType<typeof provider>["createPayment"]>[0]> = {}) {
  return {
    orderNo: "LS20261024000001ABCD",
    amountCents: 50n,
    currency: "USD",
    subject: "测试商品",
    notifyUrl: "https://shop.9527.tr/api/pay/notify/litepay",
    redirectUrl: "https://shop.9527.tr/pay/return?order_no=LS20261024000001ABCD",
    ...overrides,
  };
}

const OK_RESPONSE = {
  status_code: 200,
  message: "success",
  data: {
    amount: "0.5",
    expiration_time: 599,
    fiat: "USD",
    order_id: "LS20261024000001ABCD",
    payment_url: "https://pay.9527.tr/pay/LPabc123",
    reselect: true,
    status: 1,
    trade_id: "LPabc123",
  },
};

afterEach(() => vi.unstubAllGlobals());

describe("litepayProvider.createPayment（BEpusdt 兼容包装）", () => {
  it("渠道名为 litepay，返回快照携带 provider=litepay 与网关收银台地址", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        expect(String(url)).toBe(`${API_BASE}/api/v1/order/create-order`);
        return new Response(JSON.stringify(OK_RESPONSE), { status: 200 });
      })
    );
    const p = provider();
    expect(p.name).toBe("litepay");

    const created = await p.createPayment(input());
    expect(created.provider).toBe("litepay");
    expect(created.tradeId).toBe("LPabc123");
    expect(created.paymentUrl).toBe("https://pay.9527.tr/pay/LPabc123");

    // 请求体走 BEpusdt 协议（MD5 签名，token 来自 litepay 配置）
    expect(sent["order_id"]).toBe("LS20261024000001ABCD");
    expect(sent["notify_url"]).toBe("https://shop.9527.tr/api/pay/notify/litepay");
    expect(epusdtSign(sent, TOKEN)).toBe(sent["signature"]);
  });

  it("配置键与 bepusdt 一致：currencies / reselect 正确下发", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(JSON.stringify(OK_RESPONSE), { status: 200 });
      })
    );
    await provider({ currencies: "usdt,usdc", timeout_seconds: 600 }).createPayment(input());
    expect(sent["currencies"]).toBe("USDT,USDC");
    expect(sent["reselect"]).toBe(true);
    expect(sent["timeout"]).toBe(600);
  });

  it("回调验签通过时 payload.provider 归属 litepay 渠道", () => {
    const body: Record<string, unknown> = {
      trade_id: "LPabc123",
      order_id: "LS20261024000001ABCD",
      amount: 0.5,
      actual_amount: 0.5,
      token: "收款地址",
      status: 2,
    };
    const signed = { ...body, signature: epusdtSign(body, TOKEN) };
    const v = provider().verifyNotify(JSON.stringify(signed));
    expect(v.ok).toBe(true);
    expect(v.payload).toMatchObject({
      provider: "litepay",
      orderNo: "LS20261024000001ABCD",
      tradeId: "LPabc123",
      status: 2,
    });
  });

  it("验签失败原样透传失败结果", () => {
    const body: Record<string, unknown> = {
      order_id: "LS20261024000001ABCD",
      amount: 0.5,
      status: 2,
      signature: "0".repeat(32),
    };
    const v = provider().verifyNotify(JSON.stringify(body));
    expect(v.ok).toBe(false);
  });

  it("cancelPayment 透传到共享实现（受理返回 ok）", async () => {
    let url = "";
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (u: string | URL | Request, init?: RequestInit) => {
        url = String(u);
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({ status_code: 200, message: "success", data: { trade_id: sent["trade_id"] } }),
          { status: 200 }
        );
      })
    );
    const r = await provider().cancelPayment!("LPcancel1");
    expect(r.ok).toBe(true);
    expect(url).toBe(`${API_BASE}/api/v1/order/cancel-transaction`);
    expect(sent["trade_id"]).toBe("LPcancel1");
    expect(epusdtSign({ trade_id: "LPcancel1" }, TOKEN)).toBe(sent["signature"]);
  });
});

describe("parseLitepayPaymentTarget（历史订单快照，旧版原生 API 响应）", () => {
  const LEGACY = {
    order_no: "LP20261013000001XYZ",
    status: "WAIT_PAYMENT",
    provider: "okx",
    currency: "USDT",
    network: "USDT-TRC20",
    amount: "0.5",
    pay_address: "TN4hGjVXMzy9b4N1aGizqs",
    pay_memo: "",
    expire_time: 1760369100000,
  };

  it("从落库的 JSON 字符串解析收款信息", () => {
    const target = parseLitepayPaymentTarget(JSON.stringify(LEGACY));
    expect(target).toEqual({
      address: "TN4hGjVXMzy9b4N1aGizqs",
      provider: "okx",
      memo: "",
      amount: "0.5",
      currency: "USDT",
      network: "USDT-TRC20",
      expiresAtMs: 1760369100000,
    });
  });

  it("从对象解析并保留 memo", () => {
    const target = parseLitepayPaymentTarget({
      pay_address: "rABCD",
      pay_memo: "123456",
      amount: "1",
      currency: "XRP",
    });
    expect(target?.memo).toBe("123456");
    expect(target?.network).toBeNull();
  });

  it("缺少地址或结构非法时返回 null", () => {
    expect(parseLitepayPaymentTarget(null)).toBeNull();
    expect(parseLitepayPaymentTarget("not json")).toBeNull();
    expect(parseLitepayPaymentTarget(JSON.stringify({ pay_memo: "x" }))).toBeNull();
    expect(parseLitepayPaymentTarget([1, 2])).toBeNull();
  });
});
