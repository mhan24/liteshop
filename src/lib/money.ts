/**
 * 金额处理：内部一律「分」这个整数单位，禁止浮点参与金额运算。
 *
 * 站点只有 USD 一种计价：商品以美分定价，收银台（LitePay）按 USD 建单，
 * 回调金额也按 USD 核对，因此不再保留多币种换算。
 */

/** 全站计价币种（LitePay 只受理 USD） */
export const SITE_CURRENCY = "USD";

export class MoneyParseError extends Error {}

/**
 * "12.34" / 12.34 / 1234 → 美分整数。
 *
 * 网关回调用小数表示金额，最多可能出现 6 位小数（0.000001 USD）；
 * 低于一分的尾数无法结算，出现即判为非法金额，绝不四舍五入。
 */
export function toMinorUnits(input: string | number): number {
  const s = String(input).trim();
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(s);
  if (!m) throw new MoneyParseError(`非法金额: ${input}`);
  const [, intPart, frac = ""] = m;
  if (/[1-9]/.test(frac.slice(2))) throw new MoneyParseError(`金额精度低于 0.01，无法结算: ${input}`);
  const frac2 = frac.slice(0, 2).padEnd(2, "0");
  return Number(intPart) * 100 + Number(frac2);
}

/** 美分整数 → "12.34" */
export function formatMinor(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents).toString().padStart(3, "0");
  const body = `${abs.slice(0, -2)}.${abs.slice(-2)}`;
  return neg ? `-${body}` : body;
}

/** 美分整数 → "$12.34" */
export function formatMoney(cents: number): string {
  return `$${formatMinor(cents)}`;
}

/** 美分整数 → 网关 JSON number（两位小数可精确往返） */
export function minorToNumber(cents: number): number {
  return cents / 100;
}
