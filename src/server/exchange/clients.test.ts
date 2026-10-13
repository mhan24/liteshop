import { afterEach, describe, expect, it, vi } from "vitest";
import { createBinanceClient } from "./binance";
import { createOkxClient } from "./okx";
import { ExchangeApiError, type ExchangeCredentials } from "./types";

/**
 * 交易所客户端：响应结构不可信，必须逐项校验。
 * 这些用例覆盖"什么会被当成到账"——判断错了就是误发货或漏发货。
 */

const BINANCE_CRED: ExchangeCredentials = {
  apiKey: "bk",
  apiSecret: "bs",
  accountId: "12345",
};
const OKX_CRED: ExchangeCredentials = {
  apiKey: "ok",
  apiSecret: "os",
  passphrase: "op",
  accountId: "999",
};

const WIDE = [0, 9_999_999_999_999] as const;

function mockFetch(body: unknown, status = 200) {
  const fn = vi.fn(async () => new Response(JSON.stringify(body), { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => vi.unstubAllGlobals());

describe("币安：到账流水解析", () => {
  it("按 fundsDetail 拆条目并按币种过滤", async () => {
    mockFetch({
      code: "000000",
      success: true,
      data: [
        {
          transactionId: "T1",
          transactionTime: 1_700_000_000_000,
          receiverInfo: { binanceId: "12345" },
          fundsDetail: [
            { amount: "5.03", currency: "USDT" },
            { amount: "1", currency: "BTC" },
          ],
        },
      ],
    });
    const txs = await createBinanceClient().fetchIncoming(BINANCE_CRED, ...WIDE, "USDT");
    expect(txs).toHaveLength(1);
    expect(txs[0]).toMatchObject({
      tradeId: "T1",
      amount: "5.03",
      currency: "USDT",
      timestamp: 1_700_000_000_000,
    });
  });

  it("fundsDetail 缺失时回退顶层 amount/currency", async () => {
    mockFetch({
      code: "000000",
      success: true,
      data: [
        {
          transactionId: "T2",
          transactionTime: 1,
          amount: "9.99",
          currency: "USDT",
          receiverInfo: { binanceId: "12345" },
        },
      ],
    });
    const txs = await createBinanceClient().fetchIncoming(BINANCE_CRED, ...WIDE, "USDT");
    expect(txs).toHaveLength(1);
    expect(txs[0].amount).toBe("9.99");
  });

  it("收款方不是配置账户 → 丢弃（防误配账户把他人到账当本店收款）", async () => {
    mockFetch({
      code: "000000",
      success: true,
      data: [
        {
          transactionId: "T3",
          transactionTime: 1,
          amount: "5",
          currency: "USDT",
          receiverInfo: { binanceId: "99999" },
        },
      ],
    });
    const txs = await createBinanceClient().fetchIncoming(BINANCE_CRED, ...WIDE, "USDT");
    expect(txs).toHaveLength(0);
  });

  it("缺少 transactionId/时间 → 丢弃（无法幂等）", async () => {
    mockFetch({
      code: "000000",
      success: true,
      data: [
        { transactionTime: 1, amount: "5", currency: "USDT" },
        { transactionId: "T4", amount: "5", currency: "USDT" },
      ],
    });
    expect(await createBinanceClient().fetchIncoming(BINANCE_CRED, ...WIDE, "USDT")).toHaveLength(0);
  });

  it("业务错误码 → 抛错且不可重试（鉴权类）", async () => {
    mockFetch({ code: "-2015", success: false, message: "Invalid API-key" });
    await expect(
      createBinanceClient().fetchIncoming(BINANCE_CRED, ...WIDE, "USDT")
    ).rejects.toBeInstanceOf(ExchangeApiError);
  });

  it("请求带签名与 API Key 头", async () => {
    const fn = mockFetch({ code: "000000", success: true, data: [] });
    await createBinanceClient().fetchIncoming(BINANCE_CRED, 1, 2, "USDT");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/sapi/v1/pay/transactions?");
    expect(url).toContain("signature=");
    expect((init.headers as Record<string, string>)["X-MBX-APIKEY"]).toBe("bk");
  });

  it("凭据校验返回 uid", async () => {
    mockFetch({ uid: 12345 });
    expect(await createBinanceClient().validateCredentials(BINANCE_CRED)).toEqual({
      ok: true,
      accountId: "12345",
    });
  });

  it("凭据校验失败不抛错，返回 ok:false", async () => {
    mockFetch({ code: -2015, msg: "bad key" }, 401);
    const r = await createBinanceClient().validateCredentials(BINANCE_CRED);
    expect(r.ok).toBe(false);
    expect(r.error).toBeTruthy();
  });
});

describe("欧易：到账流水解析", () => {
  const row = (over: Record<string, unknown>) => ({
    billId: "B1",
    ccy: "USDT",
    balChg: "5.03",
    type: "72",
    ts: "1700000000000",
    ...over,
  });

  it("接受 type=72（内部转账）与 type=1（链上充值）", async () => {
    mockFetch({ code: "0", data: [row({ billId: "A", type: "72" }), row({ billId: "B", type: "1" })] });
    const txs = await createOkxClient().fetchIncoming(OKX_CRED, ...WIDE, "USDT");
    expect(txs.map((t) => t.tradeId).sort()).toEqual(["A", "B"]);
  });

  it("忽略非入账类型（转出/手续费等）", async () => {
    mockFetch({ code: "0", data: [row({ billId: "C", type: "2" }), row({ billId: "D", type: "0" })] });
    expect(await createOkxClient().fetchIncoming(OKX_CRED, ...WIDE, "USDT")).toHaveLength(0);
  });

  it("忽略非正数 balChg（转出）", async () => {
    mockFetch({ code: "0", data: [row({ billId: "E", balChg: "-5" }), row({ billId: "F", balChg: "0" })] });
    expect(await createOkxClient().fetchIncoming(OKX_CRED, ...WIDE, "USDT")).toHaveLength(0);
  });

  it("按币种与时间窗过滤", async () => {
    mockFetch({
      code: "0",
      data: [row({ billId: "G", ccy: "BTC" }), row({ billId: "H", ts: "500" })],
    });
    expect(await createOkxClient().fetchIncoming(OKX_CRED, 1000, 2000, "USDT")).toHaveLength(0);
  });

  it("业务错误码 → 抛错", async () => {
    mockFetch({ code: "50111", msg: "Invalid API Key" });
    await expect(
      createOkxClient().fetchIncoming(OKX_CRED, ...WIDE, "USDT")
    ).rejects.toBeInstanceOf(ExchangeApiError);
  });

  it("缺少 passphrase → 明确报错（不发出无效请求）", async () => {
    const client = createOkxClient();
    await expect(
      client.fetchIncoming({ ...OKX_CRED, passphrase: undefined }, ...WIDE, "USDT")
    ).rejects.toThrow(/passphrase/);
  });

  it("请求带 OK-ACCESS-* 四个头", async () => {
    const fn = mockFetch({ code: "0", data: [] });
    await createOkxClient().fetchIncoming(OKX_CRED, ...WIDE, "USDT");
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("/api/v5/asset/bills?ccy=USDT&limit=100");
    const h = init.headers as Record<string, string>;
    for (const k of ["OK-ACCESS-KEY", "OK-ACCESS-SIGN", "OK-ACCESS-TIMESTAMP", "OK-ACCESS-PASSPHRASE"]) {
      expect(h[k], k).toBeTruthy();
    }
  });

  it("凭据校验返回 uid", async () => {
    mockFetch({ code: "0", data: [{ uid: "999" }] });
    expect(await createOkxClient().validateCredentials(OKX_CRED)).toEqual({
      ok: true,
      accountId: "999",
    });
  });
});
