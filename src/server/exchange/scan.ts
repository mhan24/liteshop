import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { orders } from "@/db/schema";
import { formatPayable } from "./amount";
import { findEnabledExchange, loadExchangeCredentials } from "./channel";
import { getExchangeClient } from "./index";
import { matchTransactions, type MatchableOrder } from "./match";
import { settleExchangePayment } from "@/server/order/fulfill-order";
import { describeMatch } from "./match";

/**
 * 交易所到账扫描（cron 驱动）。
 *
 * 与网关回调的根本差别：交易所**不提供 webhook**，只能主动轮询流水。
 * 因此本服务承担 HashPay 中由「支付回调」承担的角色：
 *   拉取流水 → 匹配订单 → 复用既有幂等履约/异常到账路径结算。
 *
 * 失败处理原则（与回调一致）：**任何异常都不改订单状态**。
 * 拉取失败只记录，等下一次扫描重试；绝不因为"查不到"就关单释放库存。
 */

export interface ScanResult {
  /** 未配置任何可用的交易所渠道 */
  skipped?: string;
  /** 本次实际扫描的渠道 */
  provider?: string;
  /** 拉取到的流水条数 */
  fetched?: number;
  /** 参与匹配的订单数 */
  candidates?: number;
  /** 结算成功的订单 */
  settled: Array<{ orderNo: string; detail: string; message: string }>;
  /** 未匹配的流水（含原因，便于排查与告警） */
  unmatched: Array<{ tradeId: string; amount: string; reason: string }>;
  /** 扫描过程中的错误（不影响已结算部分） */
  errors: string[];
}

/** 该渠道下仍可能匹配到账的订单：pending（待支付） */
function loadCandidates(provider: string, asset: string): MatchableOrder[] {
  const rows = db
    .select({
      orderNo: orders.orderNo,
      expectedActualAmount: orders.expectedActualAmount,
      createdAt: orders.createdAt,
      expirationTime: orders.expirationTime,
      status: orders.status,
    })
    .from(orders)
    .where(
      and(
        eq(orders.status, "pending"),
        sql`${orders.expectedActualAmount} is not null`,
        sql`lower(${orders.expectedActualAmount}) like ${"%" + asset.toLowerCase() + "%"}`
      )
    )
    .orderBy(orders.createdAt)
    .all();

  return rows.map((r) => ({
    orderNo: r.orderNo,
    // 应付金额单独存一个 USDT 数字串，避免把「订单金额」误当「应付金额」
    expectedActualAmount: extractPayable(r.expectedActualAmount, asset),
    asset,
    createdAtMs: r.createdAt.getTime(),
    expiresAtMs: r.expirationTime ? r.expirationTime.getTime() : null,
    isTerminal: false,
  }));
}

/**
 * 从订单的 expectedActualAmount 中取出 USDT 金额。
 * 格式约定为 "<金额> <币种>"（例如 "5.03 USDT"），以便与交易所流水逐字对齐。
 */
function extractPayable(stored: string | null, asset: string): string | null {
  if (!stored) return null;
  const m = /^([0-9.]+)\s+([A-Za-z]+)$/.exec(stored.trim());
  if (!m) return stored.trim();
  return m[2].toUpperCase() === asset.toUpperCase() ? m[1] : null;
}

/** 扫描主流程：可在 cron 端点调用，也可后台手动触发 */
export async function scanExchangePayments(): Promise<ScanResult> {
  const result: ScanResult = { settled: [], unmatched: [], errors: [] };

  const provider = findEnabledExchange();
  if (!provider) {
    result.skipped = "未启用任何配置完整的交易所渠道";
    return result;
  }
  result.provider = provider;

  const loaded = loadExchangeCredentials(provider);
  if (!loaded) {
    result.errors.push("凭据缺失或解密失败，未执行扫描");
    result.skipped = "凭据不可用";
    return result;
  }
  const { cred, asset } = loaded;

  const candidates = loadCandidates(provider, asset);
  result.candidates = candidates.length;
  // 没有待支付订单时直接跳过，避免无谓消耗交易所 API 配额
  if (candidates.length === 0) {
    result.skipped = "没有待支付的交易所订单";
    return result;
  }

  // 拉取时间窗：覆盖最早候选订单的宽限前 ~ 最多一个月（交易所限制）
  const from = Math.min(...candidates.map((c) => c.createdAtMs)) - 60 * 60 * 1000;
  const to = Date.now() + 60 * 60 * 1000;

  let txs;
  try {
    txs = await getExchangeClient(provider).fetchIncoming(cred, from, to, asset);
  } catch (err) {
    result.errors.push(`拉取流水失败: ${err instanceof Error ? err.message : String(err)}`);
    return result; // 不改订单状态，等下次重试
  }
  result.fetched = txs.length;

  const { matched, unmatched } = matchTransactions(txs, candidates);

  for (const m of matched) {
    try {
      const settled = settleExchangePayment({
        provider,
        orderNo: m.orderNo,
        tradeId: m.tradeId,
        amount: formatPayable(m.paidMinor),
        paidAt: new Date(m.paidAtMs),
        raw: null,
      });
      result.settled.push({
        orderNo: m.orderNo,
        detail: describeMatch(m),
        message: settled.message,
      });
    } catch (err) {
      // 结算异常不得中断整批扫描：其余订单仍应继续处理
      result.errors.push(
        `订单 ${m.orderNo} 结算异常: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  for (const u of unmatched) {
    result.unmatched.push({ tradeId: u.tradeId, amount: u.amount, reason: u.reason });
  }

  return result;
}