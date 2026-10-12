import { afterEach, describe, expect, it, vi } from "vitest";
import { epusdtSign } from "@/lib/signature";
import {
  bepusdtProvider,
  parseBepusdtConfig,
  clampBepusdtTimeout,
  BEPUSDT_TIMEOUT_MIN,
  BEPUSDT_TIMEOUT_MAX,
  BEPUSDT_TIMEOUT_DEFAULT,
} from "./bepusdt";

/** bepusdt 渠道测试：字段/算法均以网关源码为准（PLAN §5） */

const CONFIG = { api_base: "https://pay.example.com", token: "tok", trade_type: "usdt.trc20", fiat: "CNY" };

describe("超时边界与网关 CalcTradeExpiredAt 对齐（[180,3600]，默认1200）", () => {
  it("区间内原样保留（含线上使用的 900）", () => {
    expect(clampBepusdtTimeout(900)).toBe(900);
    expect(clampBepusdtTimeout(180)).toBe(180);
    expect(clampBepusdtTimeout(3600)).toBe(3600);
  });

  it("越界钳制，避免网关静默回落到自身默认值", () => {
    // < 180：网关会忽略 → 上钳到下限
    expect(clampBepusdtTimeout(60)).toBe(BEPUSDT_TIMEOUT_MIN);
    expect(clampBepusdtTimeout(0)).toBe(BEPUSDT_TIMEOUT_MIN);
    expect(clampBepusdtTimeout(-5)).toBe(BEPUSDT_TIMEOUT_MIN);
    // > 3600：网关会忽略 → 下钳到上限
    expect(clampBepusdtTimeout(4000)).toBe(BEPUSDT_TIMEOUT_MAX);
    expect(clampBepusdtTimeout(99999)).toBe(BEPUSDT_TIMEOUT_MAX);
  });

  it("缺失/非法值回落到网关默认 1200", () => {
    expect(clampBepusdtTimeout(undefined)).toBe(BEPUSDT_TIMEOUT_DEFAULT);
    expect(clampBepusdtTimeout(Number.NaN)).toBe(BEPUSDT_TIMEOUT_DEFAULT);
    expect(clampBepusdtTimeout(Number.POSITIVE_INFINITY)).toBe(BEPUSDT_TIMEOUT_DEFAULT);
  });

  it("小数截断为整数", () => {
    expect(clampBepusdtTimeout(900.7)).toBe(900);
  });

  it("parseBepusdtConfig 对越界配置同样钳制", () => {
    expect(parseBepusdtConfig({ api_base: "https://a.b", token: "t", timeout_seconds: 900 }).timeoutSeconds).toBe(900);
    expect(parseBepusdtConfig({ api_base: "https://a.b", token: "t", timeout_seconds: 7200 }).timeoutSeconds).toBe(
      BEPUSDT_TIMEOUT_MAX
    );
  });

  it("下单请求体携带钳制后的 timeout（900 原样发送）", async () => {
    let sent: Record<string, unknown> = {};
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
        sent = JSON.parse(String(init?.body)) as Record<string, unknown>;
        return new Response(
          JSON.stringify({
            status_code: 200,
            data: { trade_id: "gw_t", payment_url: "https://pay.example.com/c/x", expiration_time: 899 },
          }),
          { status: 200 }
        );
      })
    );
    const provider = bepusdtProvider({ ...CONFIG, timeout_seconds: 900 });
    await provider.createPayment({
      orderNo: "LS20261012TIMEOUT00",
      amountCents: 100n,
      currency: "CNY",
      subject: "T",
      notifyUrl: "https://s.example.com/n",
      redirectUrl: "https://s.example.com/r",
    });
    expect(sent["timeout"]).toBe(900);

    // 越界配置 → 发送钳制后的 3600，而非被网关忽略的原始值
    const p2 = bepusdtProvider({ ...CONFIG, timeout_seconds: 9999 });
    await p2.createPayment({
      orderNo: "LS20261012TIMEOUT01",
      amountCents: 100n,
      currency: "CNY",
      subject: "T",
      notifyUrl: "https://s.example.com/n",
      redirectUrl: "https://s.example.com/r",
    });
    expect(sent["timeout"]).toBe(BEPUSDT_TIMEOUT_MAX);
  });
});

describe("parseBepusdtConfig", () => {
  it("缺省值与清洗", () => {
    const c = parseBepusdtConfig({ api_base: "https://a.b/", token: " t " });
    expect(c.apiBase).toBe("https://a.b");
    expect(c.token).toBe("t");
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
            // 网关真实语义：剩余有效期（秒），非 Unix 时间戳
            // 见 bepusdt app/handler/epusdt/epusdt.go:164
            expiration_time: 899,
            payment_url: "https://pay.example.com/checkout/x",
            reselect: true,
          },
        }),
        { status: 200 }
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const before = Date.now();
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
    // 回归：expiration_time=899（剩余秒）必须换算为「当前时间 + 899s」，
    // 而不是 new Date(899*1000) → 1970-01-01 08:14
    expect(created.expirationTime).toBeInstanceOf(Date);
    const deltaMs = created.expirationTime!.getTime() - before;
    expect(deltaMs).toBeGreaterThanOrEqual(899_000);
    expect(deltaMs).toBeLessThan(901_000);
    expect(created.expirationTime!.getUTCFullYear()).toBeGreaterThan(2000);
  });

  it("网关未返回 expiration_time 时兜底为请求 timeout，而非 null", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              status_code: 200,
              data: {
                trade_id: "gw_no_exp",
                payment_url: "https://pay.example.com/checkout/noexp",
              },
            }),
            { status: 200 }
          )
      )
    );
    const provider = bepusdtProvider(CONFIG);
    const before = Date.now();
    const created = await provider.createPayment({
      orderNo: "LS20261011NOEXP0000",
      amountCents: 990n,
      currency: "CNY",
      subject: "Demo",
      notifyUrl: "https://shop.example.com/n",
      redirectUrl: "https://shop.example.com/r",
    });
    // 未配置 timeout → 与网关默认对齐的 1200s；不得为 null，避免订单永不过期
    expect(created.expirationTime).toBeInstanceOf(Date);
    const deltaMs = created.expirationTime!.getTime() - before;
    expect(deltaMs).toBeGreaterThanOrEqual((BEPUSDT_TIMEOUT_DEFAULT - 1) * 1000);
    expect(deltaMs).toBeLessThan((BEPUSDT_TIMEOUT_DEFAULT + 1) * 1000);
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
    ).rejects.toThrow(/响应不完整/);
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

describe("api_base 协议校验（SSRF 纵深防御）", () => {
  it("仅接受 http/https", () => {
    expect(parseBepusdtConfig({ api_base: "https://pay.example.com", token: "t" }).apiBase).toBe(
      "https://pay.example.com"
    );
    expect(parseBepusdtConfig({ api_base: "http://127.0.0.1:8080/", token: "t" }).apiBase).toBe(
      "http://127.0.0.1:8080"
    );
  });

  it("拒绝非 http(s) 协议与不可解析值", () => {
    for (const bad of [
      "file:///etc/passwd",
      "data:text/html,x",
      "ftp://example.com",
      "javascript:alert(1)",
      "not-a-url",
      "//example.com",
      "",
    ]) {
      expect(parseBepusdtConfig({ api_base: bad, token: "t" }).apiBase).toBeUndefined();
    }
  });

  it("缺失 api_base 时 createPayment 拒绝执行", async () => {
    const provider = bepusdtProvider({ api_base: "file:///etc/passwd", token: "t" });
    await expect(
      provider.createPayment({
        orderNo: "LS20261012SSRF000000",
        amountCents: 100n,
        currency: "CNY",
        subject: "T",
        notifyUrl: "https://s.example.com/n",
        redirectUrl: "https://s.example.com/r",
      })
    ).rejects.toThrow(/未配置/);
  });
});

describe("网关异常响应的结果分类（P1-02）", () => {
  const CONFIG2 = { api_base: "https://pay.example.com", token: "tok" };

  it("HTTP 200 但缺 trade_id → unknown（不能证明未建单，保留待对账）", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status_code: 200, message: "success", data: { trade_id: "gw_1" } }), {
          status: 200,
        })
      )
    );
    const provider = bepusdtProvider(CONFIG2);
    await expect(
      provider.createPayment({
        orderNo: "LS20261012CLS0000001",
        amountCents: 100n,
        currency: "CNY",
        subject: "T",
        notifyUrl: "https://s/n",
        redirectUrl: "https://s/r",
      })
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("HTTP 200 但缺 payment_url → unknown", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status_code: 200, data: { trade_id: "gw_2" } }), { status: 200 })
      )
    );
    const provider = bepusdtProvider(CONFIG2);
    await expect(
      provider.createPayment({
        orderNo: "LS20261012CLS0000002",
        amountCents: 100n,
        currency: "CNY",
        subject: "T",
        notifyUrl: "https://s/n",
        redirectUrl: "https://s/r",
      })
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("明确业务拒绝（status_code>=400 且有 message）→ rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response(JSON.stringify({ status_code: 400, message: "参数错误", data: {} }), { status: 200 })
      )
    );
    const provider = bepusdtProvider(CONFIG2);
    await expect(
      provider.createPayment({
        orderNo: "LS20261012CLS0000003",
        amountCents: 100n,
        currency: "CNY",
        subject: "T",
        notifyUrl: "https://s/n",
        redirectUrl: "https://s/r",
      })
    ).rejects.toMatchObject({ outcome: "rejected" });
  });

  it("响应体无法解析 → unknown", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>gateway error</html>", { status: 200 })));
    const provider = bepusdtProvider(CONFIG2);
    await expect(
      provider.createPayment({
        orderNo: "LS20261012CLS0000004",
        amountCents: 100n,
        currency: "CNY",
        subject: "T",
        notifyUrl: "https://s/n",
        redirectUrl: "https://s/r",
      })
    ).rejects.toMatchObject({ outcome: "unknown" });
  });

  it("HTTP 5xx → unknown；4xx → rejected", async () => {
    for (const [code, expected] of [[500, "unknown"], [502, "unknown"], [400, "rejected"], [401, "rejected"]] as const) {
      vi.stubGlobal("fetch", vi.fn(async () => new Response("err", { status: code })));
      const provider = bepusdtProvider(CONFIG2);
      await expect(
        provider.createPayment({
          orderNo: `LS20261012CLS00000${code}`,
          amountCents: 100n,
          currency: "CNY",
          subject: "T",
          notifyUrl: "https://s/n",
          redirectUrl: "https://s/r",
        })
      ).rejects.toMatchObject({ outcome: expected });
    }
  });
});
