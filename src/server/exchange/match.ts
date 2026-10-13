import { formatPayable, parsePayable } from "./amount";
import type { ExchangeTransaction } from "./types";

/**
 * 交易所流水与订单的匹配（**纯函数**）。
 *
 * 与 HashPay 的最大区别：这里**不做浮点比较**。
 * 应付金额在分配阶段就被规范化为整数最小单位（0.01 USDT = 1），
 * 到账金额同样按整数解析；只有两者整数相等才算命中。
 *
 * 匹配三要素（缺一不可）：
 *  1. 金额：实付 **≥** 应付（整数比较）。多付的零头由商家吸收、按原价成交；
 *     少付（实付 < 应付）是真实短款，一律不自动履约
 *  2. 币种：完全一致
 *  3. 时间窗：落在 [订单创建时间 - 宽限, 订单过期时间 + 宽限] 内
 *
 * 另外必须满足：同一笔 tradeId 不得用于两张订单（幂等/防重复发货）。
 */

/** 时间窗宽限（毫秒）。交易所内部转账的到账时间戳与本地创建时间可能略有偏差 */
export const TIME_GRACE_MS = 10 * 60 * 1000;

/** 参与匹配的订单（由调用方从数据库读出，这里只做纯计算） */
export interface MatchableOrder {
  orderNo: string;
  /** 应付金额的十进制字符串（存在 orders.expected_actual_amount） */
  expectedActualAmount: string | null;
  /** 收款币种（USDT / USDC），用于与流水币种比较 */
  asset: string;
  /** 订单创建时间（毫秒） */
  createdAtMs: number;
  /** 订单过期时间（毫秒）；无过期时间视为不参与匹配 */
  expiresAtMs: number | null;
  /** 该订单是否已处于终态（终态订单不再自动匹配，走异常到账） */
  isTerminal: boolean;
}

export interface MatchResult {
  orderNo: string;
  tradeId: string;
  /** 实付金额（最小单位） */
  paidMinor: bigint;
  /** 应付金额（最小单位） */
  expectedMinor: bigint;
  /** 多付的零头（最小单位）；商家吸收，不要求退款 */
  offsetMinor: bigint;
  /** 到账时间（毫秒） */
  paidAtMs: number;
}

export interface UnmatchedTransaction {
  tradeId: string;
  amount: string;
  currency: string;
  timestamp: number;
  /** 无法匹配的原因，便于排查与日志 */
  reason: string;
}

export interface MatchOutcome {
  matched: MatchResult[];
  unmatched: UnmatchedTransaction[];
}

function withinWindow(tx: ExchangeTransaction, order: MatchableOrder): boolean {
  if (order.expiresAtMs === null) return false;
  return (
    tx.timestamp >= order.createdAtMs - TIME_GRACE_MS &&
    tx.timestamp <= order.expiresAtMs + TIME_GRACE_MS
  );
}

/**
 * 在候选订单中为每笔到账流水寻找唯一归属。
 *
 * 关键规则：
 * - 一笔流水最多归属一张订单（先到先得，避免一单多付/多单共用一笔）
 * - 一张订单最多匹配一笔流水
 * - 终态订单**不参与**自动匹配（应由上层登记异常到账）
 * - 已在本批内被其它订单占用的 tradeId 不再重复匹配（幂等）
 */
export function matchTransactions(
  transactions: ExchangeTransaction[],
  orders: MatchableOrder[]
): MatchOutcome {
  const matched: MatchResult[] = [];
  const unmatched: UnmatchedTransaction[] = [];

  // 按创建时间升序：先来的订单优先，避免后创建的订单"抢"早到的流水
  const candidates = [...orders].sort((a, b) => a.createdAtMs - b.createdAtMs);

  const usedOrderNos = new Set<string>();
  const usedTradeIds = new Set<string>();

  for (const tx of transactions) {
    if (usedTradeIds.has(tx.tradeId)) {
      unmatched.push({
        tradeId: tx.tradeId,
        amount: tx.amount,
        currency: tx.currency,
        timestamp: tx.timestamp,
        reason: "同一笔流水已匹配其它订单（幂等跳过）",
      });
      continue;
    }

    const txMinor = parsePayable(tx.amount);
    if (txMinor === null) {
      unmatched.push({
        tradeId: tx.tradeId,
        amount: tx.amount,
        currency: tx.currency,
        timestamp: tx.timestamp,
        reason: "到账金额格式无法识别或精度不符",
      });
      continue;
    }

    const txCcy = tx.currency.trim().toUpperCase();

    let hit: MatchableOrder | undefined;
    let hitExpected: bigint | null = null;
    let missReason = "没有金额、币种与时间窗均吻合的待支付订单";

    for (const order of candidates) {
      if (usedOrderNos.has(order.orderNo)) continue;
      if (order.isTerminal) {
        missReason = "命中的订单已是终态，应走异常到账而非自动履约";
        continue;
      }
      if (!order.expectedActualAmount) {
        missReason = "订单未记录应付金额（可能不是交易所渠道）";
        continue;
      }
      if (txCcy !== order.asset.trim().toUpperCase()) {
        missReason = `币种不符（到账 ${txCcy}，应付 ${order.asset}）`;
        continue;
      }
      if (!withinWindow(tx, order)) {
        missReason = "到账时间不在订单有效期内";
        continue;
      }
      const expected = parsePayable(order.expectedActualAmount);
      if (expected === null) {
        missReason = "订单应付金额格式异常";
        continue;
      }
      // 实付 ≥ 应付 即视为已付（零头由商家吸收，见 MatchResult.offsetMinor）；
      // 实付 < 应付 是真实短款，**不得**自动履约，继续找下一张。
      if (txMinor < expected) continue;
      hit = order;
      hitExpected = expected;
      break;
    }

    if (!hit || hitExpected === null) {
      unmatched.push({
        tradeId: tx.tradeId,
        amount: tx.amount,
        currency: tx.currency,
        timestamp: tx.timestamp,
        reason: missReason,
      });
      continue;
    }

    usedOrderNos.add(hit.orderNo);
    usedTradeIds.add(tx.tradeId);
    // 商家按订单原价成交，多出的零头由商家吸收
    const offsetMinor = txMinor - hitExpected;
    matched.push({
      orderNo: hit.orderNo,
      tradeId: tx.tradeId,
      paidMinor: txMinor,
      expectedMinor: hitExpected,
      offsetMinor: offsetMinor > 0n ? offsetMinor : 0n,
      paidAtMs: tx.timestamp,
    });
  }

  return { matched, unmatched };
}

/** 便于日志/告警：把匹配结果格式化成简短可读形式 */
export function describeMatch(m: MatchResult): string {
  return `${m.orderNo} ← ${m.tradeId} 实付 ${formatPayable(m.paidMinor)}${
    m.offsetMinor > 0n ? `（含零头 ${formatPayable(m.offsetMinor)}）` : ""
  }`;
}