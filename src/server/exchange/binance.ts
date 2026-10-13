import { binanceSign, buildBinanceQuery } from "@/lib/exchange/sign";
import {
  asArray,
  asRecord,
  asString,
  ExchangeApiError,
  fetchJson,
  type CredentialCheck,
  type ExchangeClient,
  type ExchangeCredentials,
  type ExchangeTransaction,
} from "./types";

/**
 * 币安收款（轮询「Binance Pay 交易历史」）。
 *
 * 机制说明：**不是** Binance Pay 官方商户接入（没有下单接口与回调），
 * 而是轮询操作员自己账户的到账流水，用「金额 + 时间窗 + 币种」匹配订单。
 * 因此没有 webhook，靠定时扫描发现到账。
 *
 * 端点：`GET /sapi/v1/pay/transactions`（官方名 Get Pay Trade History，USER_DATA）
 * 签名：HMAC-SHA256(queryString) → hex，作为 query 的 signature 参数
 */

const DEFAULT_BASE = "https://api.binance.com";

/** 仅成功码视为有效响应 */
const BINANCE_OK_CODE = "000000";

function base(cred: ExchangeCredentials): string {
  return (cred.apiBase?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

interface RawFund {
  amount: string;
  currency: string;
}

/**
 * 把一行 Pay 记录拆成若干「到账」条目。
 *
 * 一行可能含多个 fundsDetail（例如同时收到两种币），必须逐条比较，
 * 否则会漏匹配。fundsDetail 缺失时回退到顶层 amount/currency。
 */
function toTransactions(row: Record<string, unknown>): ExchangeTransaction[] {
  const tradeId = asString(row["transactionId"]);
  const ts = Number(row["transactionTime"]);
  if (!tradeId || !Number.isFinite(ts)) return [];

  const receiverRec = asRecord(row["receiverInfo"]);
  const receiver = receiverRec ? asString(receiverRec["binanceId"]) : null;

  const funds = asArray(row["fundsDetail"]).flatMap((f): RawFund[] => {
    const rec = asRecord(f);
    if (!rec) return [];
    const amount = asString(rec["amount"]);
    const currency = asString(rec["currency"]);
    return amount && currency ? [{ amount, currency }] : [];
  });

  const list: RawFund[] = funds.length
    ? funds
    : (() => {
        const amount = asString(row["amount"]);
        const currency = asString(row["currency"]);
        return amount && currency ? [{ amount, currency }] : [];
      })();

  return list.map((f) => ({
    tradeId,
    timestamp: ts,
    amount: f.amount,
    currency: f.currency,
    receiver,
    raw: row,
  }));
}

/** 发送一个已签名的 GET 请求 */
async function signedGet(
  cred: ExchangeCredentials,
  path: string,
  params: Record<string, string | number>
): Promise<unknown> {
  const withMeta: Record<string, string | number> = {
    ...params,
    recvWindow: 5000,
    timestamp: Date.now(),
  };
  const query = buildBinanceQuery(withMeta);
  const signature = binanceSign(cred.apiSecret, query);
  const url = `${base(cred)}${path}?${query}&signature=${signature}`;
  return fetchJson(url, { method: "GET", headers: { "X-MBX-APIKEY": cred.apiKey } });
}

export function createBinanceClient(): ExchangeClient {
  return {
    id: "binance",

    async validateCredentials(cred: ExchangeCredentials): Promise<CredentialCheck> {
      try {
        const json = asRecord(await signedGet(cred, "/api/v3/account", {}));
        const uid = json ? asString(json["uid"]) : null;
        if (!uid) {
          return { ok: false, error: "币安未返回账户 uid，请确认 API Key 权限为「允许读取」" };
        }
        return { ok: true, accountId: uid };
      } catch (err) {
        return {
          ok: false,
          error: err instanceof ExchangeApiError ? err.message : String(err),
        };
      }
    },

    async fetchIncoming(
      cred: ExchangeCredentials,
      from: number,
      to: number,
      currency: string
    ): Promise<ExchangeTransaction[]> {
      const json = asRecord(
        await signedGet(cred, "/sapi/v1/pay/transactions", {
          startTime: Math.floor(from),
          endTime: Math.floor(to),
          limit: 100,
        })
      );
      if (!json) throw new ExchangeApiError("币安响应结构异常", true);
      if (json["success"] === false || asString(json["code"]) !== BINANCE_OK_CODE) {
        // 鉴权/权限类错误重试无意义；其余（含限流）视为可重试
        const code = asString(json["code"]) ?? "";
        const retryable = code === "-1003" || code === "-1015"; // 限流
        throw new ExchangeApiError(
          `币安返回错误: ${asString(json["message"]) ?? JSON.stringify(json).slice(0, 200)}`,
          retryable
        );
      }

      const want = currency.trim().toUpperCase();
      return asArray(json["data"])
        .flatMap((row) => {
          const rec = asRecord(row);
          return rec ? toTransactions(rec) : [];
        })
        .filter((t) => t.currency.trim().toUpperCase() === want)
        // 收款方必须是配置的账户：防止误配账户导致把他人到账当本店收款
        .filter((t) => t.receiver === null || t.receiver === cred.accountId);
    },
  };
}
