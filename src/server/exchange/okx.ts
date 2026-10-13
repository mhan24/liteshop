import { buildOkxRequestPath, okxSign } from "@/lib/exchange/sign";
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
 * 欧易收款（轮询「资金账单」）。
 *
 * 端点：`GET /api/v5/asset/bills`
 * 签名：HMAC-SHA256(timestamp + method + requestPath) → base64，
 *      放 `OK-ACCESS-SIGN` 头；requestPath **含 query**。
 *
 * 只认入账类型：
 *   1  = Deposit（链上充值）
 *   72 = Token received（内部转账）
 * 并额外要求 `balChg > 0`（正数即入账），避免把转出/手续费当收款。
 */

const DEFAULT_BASE = "https://www.okx.com";

/** 入账类型白名单（见 OKX 文档 bill type 枚举） */
const INCOMING_TYPES = new Set(["1", "72"]);

function base(cred: ExchangeCredentials): string {
  return (cred.apiBase?.trim() || DEFAULT_BASE).replace(/\/+$/, "");
}

/** 发送一个已签名的 GET 请求 */
async function signedGet(
  cred: ExchangeCredentials,
  path: string,
  params: Record<string, string | number>
): Promise<unknown> {
  if (!cred.passphrase) {
    throw new ExchangeApiError("欧易需要 API Key 的 passphrase", false);
  }
  const requestPath = buildOkxRequestPath(path, params);
  // 时间戳用 ISO8601（含毫秒），与官方要求一致
  const timestamp = new Date().toISOString();
  const sign = okxSign(cred.apiSecret, timestamp, "GET", requestPath);
  return fetchJson(`${base(cred)}${requestPath}`, {
    method: "GET",
    headers: {
      "OK-ACCESS-KEY": cred.apiKey,
      "OK-ACCESS-SIGN": sign,
      "OK-ACCESS-TIMESTAMP": timestamp,
      "OK-ACCESS-PASSPHRASE": cred.passphrase,
      "Content-Type": "application/json",
    },
  });
}

/** OKX 用 code === "0" 表示成功 */
function assertOk(json: Record<string, unknown>): void {
  const code = asString(json["code"]);
  if (code === "0") return;
  // 50011 = 限流；50001/50111/50112 等为鉴权类，重试无意义
  const retryable = code === "50011" || code === "50013";
  throw new ExchangeApiError(
    `欧易返回错误 ${code ?? ""}: ${asString(json["msg"]) ?? ""}`,
    retryable
  );
}

export function createOkxClient(): ExchangeClient {
  return {
    id: "okx",

    async validateCredentials(cred: ExchangeCredentials): Promise<CredentialCheck> {
      try {
        const json = asRecord(await signedGet(cred, "/api/v5/account/config", {}));
        if (!json) return { ok: false, error: "欧易响应结构异常" };
        assertOk(json);
        const first = asRecord(asArray(json["data"])[0]);
        const uid = first ? asString(first["uid"]) : null;
        if (!uid) return { ok: false, error: "欧易未返回账户 uid，请确认 API Key 为只读权限" };
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
        await signedGet(cred, "/api/v5/asset/bills", {
          ccy: currency.trim().toUpperCase(),
          limit: 100,
        })
      );
      if (!json) throw new ExchangeApiError("欧易响应结构异常", true);
      assertOk(json);

      const want = currency.trim().toUpperCase();
      return asArray(json["data"]).flatMap((row): ExchangeTransaction[] => {
        const rec = asRecord(row);
        if (!rec) return [];
        const tradeId = asString(rec["billId"]);
        const ts = Number(rec["ts"]);
        const amount = asString(rec["balChg"]);
        const ccy = asString(rec["ccy"]);
        const type = asString(rec["type"]);
        if (!tradeId || !Number.isFinite(ts) || !amount || !ccy) return [];
        if (!type || !INCOMING_TYPES.has(type)) return [];
        // 只认入账（balChg 为负是转出）
        if (!(Number(amount) > 0)) return [];
        if (ccy.trim().toUpperCase() !== want) return [];
        // 时间窗过滤（接口只按 limit 返回最近记录，窗口由本地判断）
        if (ts < from || ts > to) return [];
        return [
          {
            tradeId,
            timestamp: ts,
            amount,
            currency: ccy,
            // 欧易账单不返回收款方；账单本身由本账户 Key 拉取，天然只含本账户
            receiver: null,
            raw: rec,
          },
        ];
      });
    },
  };
}
