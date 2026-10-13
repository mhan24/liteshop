import { timingSafeEqual } from "node:crypto";
import { envConfig } from "@/lib/env";
import { scanExchangePayments } from "@/server/exchange/scan";

/**
 * 交易所到账扫描（定时器）。
 *
 * 交易所（Binance/OKX）**不提供支付 webhook**，买家是「内部转账到我的
 * 账户」，因此到账只能靠**轮询账户流水**发现。这是本端点存在的原因。
 *
 * 建议频率：每分钟（延迟 ~1 分钟）。币安该接口 Weight 很高，
 * 但扫描器在没有待支付订单时会直接跳过，不会空转消耗配额。
 *
 *   * * * * * curl -s -H "x-cron-secret: $CRON_SECRET" https://站点/api/cron/exchange
 *
 * 鉴权：与 /api/cron/expire 共用 CRON_SECRET，常量时间比较，fail closed。
 * 安全性：任一异常都不修改订单状态（扫描器内部保证），失败只记录待重试。
 */

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function authorized(request: Request): boolean {
  const expected = envConfig.cronSecret;
  if (!expected) return false;
  const header = request.headers.get("x-cron-secret") ?? "";
  const bearer = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const given = header || bearer;
  if (!given) return false;
  return safeEqual(given, expected);
}

async function handle(request: Request): Promise<Response> {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await scanExchangePayments();
    return Response.json({ ok: true, ...result });
  } catch (err) {
    // 扫描整体异常也不应让 cron 认为成功（便于外部告警）
    console.error("[cron-exchange-scan]", err);
    return Response.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  return await handle(request);
}

export async function GET(request: Request): Promise<Response> {
  return await handle(request);
}