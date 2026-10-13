import { isZeroDecimalCurrency } from "@/lib/money";

/**
 * 交易所收款的应付金额计算（**纯函数**，禁浮点，全走整数最小单位）。
 *
 * 背景：交易所收款没有 memo/tag 可用，只能靠「唯一金额」把到账流水
 * 匹配到订单 —— 同一收款账户里，若两笔订单应付金额相同，流水无法区分。
 * 因此分配时要保证**同一账户 + 同一币种下金额唯一**。
 *
 * 关键设计：
 * - 全程 bigint，**不使用浮点**（0.1+0.2 问题在钱上不可接受）
 * - 汇率以字符串传入并缩放到 1e8，避免 float 误差
 * - 汇率换算后**向上取整**到可展示精度：绝不能让买家因为舍入而少付
 * - 应付金额以「万分之一」（0.01 USDT）为最小展示单位递增去重，
 *   与 HashPay 的做法一致（2 位小数、+0.01 递增）
 */

/** 应付金额的展示精度：USDT 内部转账通常只显示 2 位小数 */
export const PAYABLE_DECIMALS = 2;
/** 应付金额的最小单位基数：1 = 0.01 USDT */
const PAYABLE_UNIT = 10n ** BigInt(PAYABLE_DECIMALS);

/** 汇率缩放基数：rate 以该精度解析，避免用浮点 */
const RATE_SCALE_DECIMALS = 8;
const RATE_SCALE = 10n ** BigInt(RATE_SCALE_DECIMALS);

/**
 * 解析十进制字符串 → 应付金额最小单位（0.01 为 1）。
 *
 * 超出精度的非零位视为**不匹配**（返回 null）而非静默截断：
 * 买家实付 0.689999 与应付 0.69 是两回事，截断会造成误发货。
 * 仅接受尾部 0（"5.030000" → 503 → 5.03）。
 */
export function parsePayable(value: string): bigint | null {
  const v = value.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return null;
  const intPart = m[1];
  const frac = m[2] ?? "";
  if (frac.length > PAYABLE_DECIMALS) {
    // 高位必须全为 0，否则不是同一个金额
    if (/[1-9]/.test(frac.slice(PAYABLE_DECIMALS))) return null;
  }
  const padded = (frac + "0".repeat(PAYABLE_DECIMALS)).slice(0, PAYABLE_DECIMALS);
  return BigInt(intPart) * PAYABLE_UNIT + BigInt(padded === "" ? "0" : padded);
}

/** 应付金额最小单位 → 十进制字符串（"5.03"） */
export function formatPayable(minor: bigint): string {
  const neg = minor < 0n;
  const abs = neg ? -minor : minor;
  const intPart = abs / PAYABLE_UNIT;
  const frac = abs % PAYABLE_UNIT;
  const fracStr = frac.toString().padStart(PAYABLE_DECIMALS, "0");
  return `${neg ? "-" : ""}${intPart}.${fracStr}`;
}

/**
 * 解析汇率字符串 → 1e8 缩放后的 bigint。
 *
 * 语义：`rate` = 1 USDT 价值多少站点币种。例如站点币种为 CNY、rate="7.25"
 * 表示 1 USDT ≈ 7.25 CNY。
 *
 * 返回 null 表示非法（非数字 / 非正数 / 超出 8 位精度）。
 */
export function parseRate(rate: string): bigint | null {
  const v = rate.trim();
  const m = /^(\d+)(?:\.(\d+))?$/.exec(v);
  if (!m) return null;
  const frac = m[2] ?? "";
  if (frac.length > RATE_DECIMALS_MAX()) return null;
  const padded = (frac + "0".repeat(RATE_SCALE_DECIMALS)).slice(0, RATE_SCALE_DECIMALS);
  const scaled = BigInt(m[1]) * RATE_SCALE + BigInt(padded);
  return scaled > 0n ? scaled : null;
}

function RATE_DECIMALS_MAX(): number {
  return RATE_SCALE_DECIMALS;
}

/**
 * 站点币种金额 → 应付 USDT 金额（最小单位，向上取整）。
 *
 * 计算式（全程整数）：
 *   payable = ceil( fiatMinor × 100 × RATE_SCALE / (10^fiatDecimals × rateScaled) )
 *
 * 之所以向上取整：宁可让买家多付一点点，也不能少付 —— 少付会导致
 * 金额对不上而无法自动匹配，只能转人工。
 */
export function fiatToPayableMinor(
  fiatMinor: bigint,
  fiatCurrency: string,
  rate: string
): bigint {
  if (fiatMinor <= 0n) throw new Error("订单金额必须为正");
  const rateScaled = parseRate(rate);
  if (rateScaled === null) throw new Error(`汇率无效: ${rate}`);

  const fiatDecimals = isZeroDecimalCurrency(fiatCurrency) ? 0n : 2n;
  const numerator = fiatMinor * PAYABLE_UNIT * RATE_SCALE;
  const denominator = 10n ** fiatDecimals * rateScaled;
  return (numerator + denominator - 1n) / denominator; // 向上取整
}

/**
 * 分配**唯一**的应付金额：在 base 之上按最小展示单位递增，直到不再冲突。
 *
 * @param base      换算出的基准应付金额（最小单位）
 * @param usedSet   同一收款账户 + 币种下，已被占用的金额集合（规范化字符串）
 * @param maxTries  最多尝试多少个值，防止极端情况下无限循环
 * @returns 分配到的金额；找不到可用值时返回 null（应拒绝建单而非制造歧义）
 */
export function allocateUniquePayable(
  base: bigint,
  usedSet: ReadonlySet<string>,
  maxTries = 100
): bigint | null {
  for (let i = 0; i < maxTries; i += 1) {
    const candidate = base + BigInt(i);
    if (!usedSet.has(formatPayable(candidate))) return candidate;
  }
  return null;
}