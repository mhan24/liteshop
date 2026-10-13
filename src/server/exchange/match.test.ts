import { describe, expect, it } from "vitest";
import { matchTransactions, type MatchableOrder } from "./match";
import type { ExchangeTransaction } from "./types";

/**
 * 匹配的判定就是「会不会错发货」，因此这里逐条覆盖：
 * 金额不符、币种不符、超窗、终态订单、同一笔流水重复、同一订单多笔到账。
 */

const T0 = 1_700_000_000_000;
const WINDOW = 15 * 60 * 1000;

function order(over: Partial<MatchableOrder> = {}): MatchableOrder {
  return {
    orderNo: "LS001",
    expectedActualAmount: "5.03",
    asset: "USDT",
    createdAtMs: T0,
    expiresAtMs: T0 + WINDOW,
    isTerminal: false,
    ...over,
  };
}

function tx(over: Partial<ExchangeTransaction> = {}): ExchangeTransaction {
  return {
    tradeId: "T1",
    timestamp: T0 + 60_000,
    amount: "5.03",
    currency: "USDT",
    receiver: null,
    raw: {},
    ...over,
  };
}

describe("matchTransactions", () => {
  it("金额精确命中 → 匹配成功", () => {
    const r = matchTransactions([tx()], [order()]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].orderNo).toBe("LS001");
    expect(r.matched[0].offsetMinor).toBe(0n);
    expect(r.unmatched).toHaveLength(0);
  });

  it("多付零头 → 仍按原价成交，零头记为 offset", () => {
    const r = matchTransactions([tx({ amount: "5.05" })], [order()]);
    expect(r.matched).toHaveLength(1);
    // 实付 505，应付 503，零头 2（0.02）
    expect(r.matched[0].offsetMinor).toBe(2n);
  });

  it("少付 → 不匹配（不得自动发货）", () => {
    const r = matchTransactions([tx({ amount: "5.02" })], [order()]);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched[0].reason).toMatch(/没有金额/);
  });

  it("金额精度不匹配（5.031）→ 不匹配", () => {
    const r = matchTransactions([tx({ amount: "5.031" })], [order()]);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched[0].reason).toMatch(/精度/);
  });

  it("币种不符 → 不匹配", () => {
    const r = matchTransactions([tx({ currency: "USDC" })], [order()]);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched[0].reason).toMatch(/币种不符/);
  });

  it("币种大小写不敏感", () => {
    const r = matchTransactions([tx({ currency: "usdt" })], [order({ asset: "usdt" })]);
    expect(r.matched).toHaveLength(1);
  });

  it("时间窗内命中（含前后宽限）", () => {
    const before = tx({ timestamp: T0 - 9 * 60 * 1000 });
    const after = tx({ timestamp: T0 + WINDOW + 9 * 60 * 1000 });
    expect(matchTransactions([before], [order()]).matched).toHaveLength(1);
    expect(matchTransactions([after], [order()]).matched).toHaveLength(1);
  });

  it("超出时间窗 → 不匹配", () => {
    const tooEarly = tx({ timestamp: T0 - 20 * 60 * 1000 });
    const tooLate = tx({ timestamp: T0 + WINDOW + 20 * 60 * 1000 });
    expect(matchTransactions([tooEarly], [order()]).matched).toHaveLength(0);
    expect(matchTransactions([tooLate], [order()]).matched).toHaveLength(0);
  });

  it("无过期时间的订单不参与匹配", () => {
    const r = matchTransactions([tx()], [order({ expiresAtMs: null })]);
    expect(r.matched).toHaveLength(0);
  });

  it("终态订单不自动匹配 → 提示走异常到账", () => {
    const r = matchTransactions([tx()], [order({ isTerminal: true })]);
    expect(r.matched).toHaveLength(0);
    expect(r.unmatched[0].reason).toMatch(/终态/);
  });

  it("订单无应付金额（非交易所渠道）→ 不匹配", () => {
    const r = matchTransactions([tx()], [order({ expectedActualAmount: null })]);
    expect(r.matched).toHaveLength(0);
  });

  it("同一笔流水不会被两张订单同时吃掉（先到先得）", () => {
    const o1 = order({ orderNo: "LS001", createdAtMs: T0 });
    const o2 = order({ orderNo: "LS002", createdAtMs: T0 + 1000 });
    const r = matchTransactions([tx()], [o1, o2]);
    expect(r.matched).toHaveLength(1);
    // 更早创建的订单优先
    expect(r.matched[0].orderNo).toBe("LS001");
  });

  it("一笔流水重复出现只匹配一次（幂等）", () => {
    const r = matchTransactions([tx(), tx({ timestamp: T0 + 120_000 })], [order()]);
    expect(r.matched).toHaveLength(1);
    expect(r.unmatched).toHaveLength(1);
    expect(r.unmatched[0].reason).toMatch(/幂等/);
  });

  it("一笔流水对多张同额订单 → 只有一张能中，其余进入人工", () => {
    const o1 = order({ orderNo: "LS001", createdAtMs: T0 });
    const o2 = order({ orderNo: "LS002", createdAtMs: T0 + 1000 });
    const r = matchTransactions([tx()], [o1, o2]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].orderNo).toBe("LS001");
  });

  it("不同金额的多张订单各归其位", () => {
    const txs = [
      tx({ tradeId: "TA", amount: "5.03", timestamp: T0 + 1000 }),
      tx({ tradeId: "TB", amount: "5.04", timestamp: T0 + 2000 }),
    ];
    const orders = [
      order({ orderNo: "LS001", expectedActualAmount: "5.03" }),
      order({ orderNo: "LS002", expectedActualAmount: "5.04", createdAtMs: T0 + 500 }),
    ];
    const r = matchTransactions(txs, orders);
    expect(r.matched).toHaveLength(2);
    expect(r.matched.map((m) => m.orderNo).sort()).toEqual(["LS001", "LS002"]);
  });

  it("空输入不报错", () => {
    expect(matchTransactions([], []).matched).toHaveLength(0);
    expect(matchTransactions([], [order()]).unmatched).toHaveLength(0);
    expect(matchTransactions([tx()], []).unmatched).toHaveLength(1);
  });

  it("同号订单候选中，金额命中才选中（不会错配到同号不同额）", () => {
    const r = matchTransactions([tx({ amount: "5.03" })], [
      order({ orderNo: "LS001", expectedActualAmount: "9.99" }),
      order({ orderNo: "LS002", expectedActualAmount: "5.03" }),
    ]);
    expect(r.matched).toHaveLength(1);
    expect(r.matched[0].orderNo).toBe("LS002");
  });
});