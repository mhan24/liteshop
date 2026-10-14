import { afterEach, describe, expect, it, vi } from "vitest";
import { PaymentCreationError } from "./index";
import {
  centsToAmountString,
  litepayAddressUrl,
  litepayCallbackSignString,
  litepayMerchantSignString,
  litepayProvider,
  mapLitepayEventToStatus,
  parseLitepayConfig,
  parseLitepayPaymentTarget,
} from "./litepay";
import { hmacHex, sha256Hex } from "@/lib/signature";

/**
 * litepay（Go 网关）渠道契约测试。
 *
 * 这些断言与网关侧实现逐字对齐，任一侧改动签名串/字段名都会让测试失败——
 * 这正是我们想要的：签名串不一致在生产上只表现为「401 签名校验失败」，
 * 极难排查。
 */

const SECRET = "a".repeat(64);
const ACCESS_KEY = "ak_0123456789abcdef";
const API_BASE = "https://pay.9527.tr";

function provider(config: Record<string, unknown> = {}) {
  return litepayProvider({
    api_base: API_BASE,
    merchant_id: ACCESS_KEY,
    secret: SECRET,
    coin: "USDT",
    network: "TRC20",
    ...config,
  });
}

function input(overrides: Partial<Parameters<ReturnType<typeof provider>["createPayment"]>[0]> = {}) {
  return {
    orderNo: "LS20261013000001ABCD",
    amountCents: 50n,
    currency: "USD",
    subject: "测试商品",
    notifyUrl: "https://shop.9527.tr/api/pay/notify/litepay",
    redirectUrl: "https://shop.9527.tr/pay/return?order_no=LS20261013000001ABCD",
    timeoutSeconds: 900,
    ...overrides,
  };
}

const OK_RESPONSE = {
  code: "OK",
  message: "ok",
  data: {
    order_no: "LP20261013000001XYZ",
    merchant_order_no: "LS20261013000001ABCD",
    status: "WAIT_PAYMENT",
    provider: "okx",
    currency: "USDT",
    network: "USDT-TRC20",
    amount: "0.5",
    paid_amount: "0",
    pay_address: "TN4hGjVXMzy9b4N1aGizqs",
    pay_memo: "",
    expire_time: 1760369100000,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** 断言调用抛出 PaymentCreationError 并返回该错误（供 outcome 分类断言） */
async function expectCreationError(p: ReturnType<typeof provider>): Promise<PaymentCreationError> {
  try {
    await p.createPayment(input());
  } catch (e) {
    if (e instanceof PaymentCreationError) return e;
    throw e;
  }
  throw new Error("期望抛出 PaymentCreationError，但调用成功");
}

describe("parseLitepayConfig", () => {
  it("读取 merchant_id（既有生产键）作为 Access Key", () => {
    const cfg = parseLitepayConfig({
      api_base: "https://pay.9527.tr/",
      merchant_id: ACCESS_KEY,
      secret: SECRET,
    });
    expect(cfg.apiBase).toBe("https://pay.9527.tr");
    expect(cfg.accessKey).toBe(ACCESS_KEY);
  });

  it("优先使用 access_key，其次回退 merchant_id", () => {
    expect(parseLitepayConfig({ access_key: "ak_new", merchant_id: "ak_old" }).accessKey).toBe("ak_new");
    expect(parseLitepayConfig({ merchant_id: "ak_old" }).accessKey).toBe("ak_old");
    expect(parseLitepayConfig({}).accessKey).toBeUndefined();
  });

  it("空字符串视为未配置", () => {
    expect(parseLitepayConfig({ api_base: "   ", secret: "" }).apiBase).toBeUndefined();
  });

  it("兼容旧配置时默认使用 Binance，并允许显式选择 OKX", () => {
    expect(parseLitepayConfig({}).provider).toBe("binance");
    expect(parseLitepayConfig({ provider: "okx" }).provider).toBe("okx");
    expect(parseLitepayConfig({ provider: "unsupported" }).provider).toBeUndefined();
  });
});

describe("centsToAmountString", () => {
  it("精确输出两位小数（不经过浮点）", () => {
    expect(centsToAmountString(0n)).toBe("0.00");
    expect(centsToAmountString(50n)).toBe("0.50");
    expect(centsToAmountString(1234n)).toBe("12.34");
    expect(centsToAmountString(100000n)).toBe("1000.00");
  });
});

describe("签名串", () => {
  it("商户请求待签串为 METHOD\\nPATH\\nTS\\nNONCE\\nSHA256(body)", () => {
    const body = '{"a":1}';
    const s = litepayMerchantSignString("post", "/api/v1/orders", "1700000000000", "n1", body);
    expect(s).toBe(["POST", "/api/v1/orders", "1700000000000", "n1", sha256Hex(body)].join("\n"));
  });

  it("回调待签串为 timestamp\\nnonce\\nevent_id\\nSHA256(body)", () => {
    const body = '{"x":2}';
    const s = litepayCallbackSignString("1700000000000", "n1", "evt_1", body);
    expect(s).toBe(["1700000000000", "n1", "evt_1", sha256Hex(body)].join("\n"));
  });
});

describe("createPayment", () => {
  it("成功：按新契约发送请求并映射响应", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(OK_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    const created = await provider().createPayment(input());

    expect(created.tradeId).toBe("LP20261013000001XYZ");
    // 新网关无托管收银台：paymentUrl 指向站内收款信息页
    expect(created.paymentUrl).toBe(litepayAddressUrl("LS20261013000001ABCD"));
    expect(created.expectedActualAmount).toBe("0.5");
    expect(created.expirationTime?.getTime()).toBe(1760369100000);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${API_BASE}/api/v1/orders`);

    const headers = init.headers as Record<string, string>;
    expect(headers["X-LitePay-Key"]).toBe(ACCESS_KEY);
    expect(headers["X-LitePay-Nonce"]).toMatch(/^[0-9a-f]{32}$/);

    const body = init.body as string;
    const sent = JSON.parse(body);
    expect(sent.merchant_order_no).toBe("LS20261013000001ABCD");
    expect(sent.amount).toBe("0.50");
    expect(sent.currency).toBe("USDT");
    expect(sent.network).toBe("TRC20");
    expect(sent.provider).toBe("binance");
    expect(sent.callback_url).toBe("https://shop.9527.tr/api/pay/notify/litepay");
    expect(sent.expire_in).toBe(900);
    // Go 网关启用了 DisallowUnknownFields，商品名称只能使用 description。
    expect(sent.description).toBe("测试商品");
    expect(sent).not.toHaveProperty("subject");

    // 关键：签名必须与网关的待签串完全一致
    const expected = hmacHex(
      SECRET,
      litepayMerchantSignString("POST", "/api/v1/orders", headers["X-LitePay-Timestamp"], headers["X-LitePay-Nonce"], body)
    );
    expect(headers["X-LitePay-Signature"]).toBe(expected);
  });

  it("按设置发送 LitePay 上游 provider", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify(OK_RESPONSE), {
        status: 200,
        headers: { "content-type": "application/json" },
      })
    );
    vi.stubGlobal("fetch", fetchMock);

    await provider({ provider: "okx" }).createPayment(input());

    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string).provider).toBe("okx");
  });

  it("未配置凭据时直接抛错（不发请求）", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider({ secret: "" }).createPayment(input())).rejects.toThrow(/未配置/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("HTTP 4xx 归类为 rejected（网关明确拒绝，可回补库存）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response('{"code":"UNAUTHORIZED"}', { status: 401 })));
    await expect(provider().createPayment(input())).rejects.toMatchObject({
      name: "PaymentCreationError",
      outcome: "rejected",
    });
  });

  it("HTTP 5xx 归类为 unknown（可能已建单，不得释放库存）", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("boom", { status: 502 })));
    const err = await expectCreationError(provider());
    expect(err.outcome).toBe("unknown");
  });

  it("网络超时归类为 unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });
      })
    );
    const err = await expectCreationError(provider());
    expect(err.outcome).toBe("unknown");
  });

  it("200 但 code 非 OK 归类为 unknown（不假设未建单）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ code: "INTERNAL_ERROR", message: "boom" }), { status: 200 }))
    );
    const err = await expectCreationError(provider());
    expect(err.outcome).toBe("unknown");
  });

  it("200 但缺少收款地址归类为 unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ code: "OK", data: { order_no: "LP1" } }), { status: 200 })
      )
    );
    const err = await expectCreationError(provider());
    expect(err.outcome).toBe("unknown");
  });
});

describe("verifyNotify", () => {
  const eventBody = JSON.stringify({
    event_id: "evt_abc",
    event_type: "order.paid",
    order_no: "LP20261013000001XYZ",
    merchant_order_no: "LS20261013000001ABCD",
    status: "SUCCESS",
    provider: "okx",
    currency: "USDT",
    network: "USDT-TRC20",
    amount: "0.5",
    paid_amount: "0.5",
    paid_at: 1760369100000,
    late: false,
  });

  function headersFor(body: string, opts: { ts?: string; nonce?: string; eventId?: string; sig?: string } = {}) {
    const ts = opts.ts ?? String(Date.now());
    const nonce = opts.nonce ?? "n1";
    const eventId = opts.eventId ?? "evt_abc";
    const sig = opts.sig ?? hmacHex(SECRET, litepayCallbackSignString(ts, nonce, eventId, body));
    return new Headers({
      "x-litepay-timestamp": ts,
      "x-litepay-nonce": nonce,
      "x-litepay-event-id": eventId,
      "x-litepay-signature": sig,
    });
  }

  it("验签通过并按新字段映射", () => {
    const result = provider().verifyNotify(eventBody, headersFor(eventBody));
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({
      provider: "litepay",
      orderNo: "LS20261013000001ABCD",
      tradeId: "LP20261013000001XYZ",
      status: 2,
      amount: "0.5",
      actualAmount: "0.5",
    });
  });

  it("报文被篡改时验签失败", () => {
    const tampered = eventBody.replace("0.5", "9.9");
    const result = provider().verifyNotify(tampered, headersFor(eventBody));
    expect(result.ok).toBe(false);
  });

  it("时间戳超窗视为重放", () => {
    const old = String(Date.now() - 10 * 60 * 1000);
    const result = provider().verifyNotify(eventBody, headersFor(eventBody, { ts: old }));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/时间戳/);
  });

  it("缺少签名请求头时拒绝", () => {
    const result = provider().verifyNotify(eventBody, new Headers());
    expect(result.ok).toBe(false);
  });

  it("过期事件映射为 status=3", () => {
    const body = JSON.stringify({ event_type: "order.expired", merchant_order_no: "LS1", order_no: "LP1" });
    const result = provider().verifyNotify(body, headersFor(body));
    expect(result.ok).toBe(true);
    expect(result.payload?.status).toBe(3);
  });

  it("未知事件不推进订单", () => {
    const body = JSON.stringify({ event_type: "order.whatever", merchant_order_no: "LS1" });
    const result = provider().verifyNotify(body, headersFor(body));
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/未知事件/);
  });

  it("缺少 merchant_order_no 时拒绝", () => {
    const body = JSON.stringify({ event_type: "order.paid", order_no: "LP1" });
    const result = provider().verifyNotify(body, headersFor(body));
    expect(result.ok).toBe(false);
  });
});

describe("parseLitepayPaymentTarget", () => {
  it("从落库的 JSON 字符串解析收款信息", () => {
    const target = parseLitepayPaymentTarget(JSON.stringify(OK_RESPONSE.data));
    expect(target).toEqual({
      address: "TN4hGjVXMzy9b4N1aGizqs",
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

describe("mapLitepayEventToStatus", () => {
  it("按事件类型映射本站状态", () => {
    expect(mapLitepayEventToStatus("order.paid")).toBe(2);
    expect(mapLitepayEventToStatus("order.expired")).toBe(3);
    expect(mapLitepayEventToStatus("order.closed")).toBe(3);
    expect(mapLitepayEventToStatus("order.failed")).toBe(3);
    expect(mapLitepayEventToStatus("nope")).toBeNull();
  });
});
