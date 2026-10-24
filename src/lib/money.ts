/**
 * 金额处理：内部一律「最小货币单位」整数（分），禁止浮点参与金额运算。
 *
 * - 两位小数币种（USD/CNY/EUR/GBP）：1 元 = 100 分
 * - 零小数币种（JPY）：1 元 = 1（不接受小数）
 */

export const ZERO_DECIMAL_CURRENCIES = new Set(["JPY", "KRW"]);

export class MoneyParseError extends Error {}

export function isZeroDecimalCurrency(currency: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(currency.toUpperCase());
}

/** "12.34" / 12.34 / 1234 → 最小单位整数；拒绝非法与超精度输入 */
export function toMinorUnits(input: string | number, currency: string): number {
  const cur = currency.toUpperCase();
  const s = String(input).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyParseError(`非法金额: ${input}`);
  const [, sign, intPart, frac = ""] = m;
  if (isZeroDecimalCurrency(cur)) {
    if (/[1-9]/.test(frac)) throw new MoneyParseError(`${cur} 不支持小数金额: ${input}`);
    const v = Number(intPart);
    return sign === "-" ? -v : v;
  }
  if (frac.length > 2) throw new MoneyParseError(`金额最多两位小数: ${input}`);
  const frac2 = frac.padEnd(2, "0");
  const v = Number(intPart) * 100 + Number(frac2 || "0");
  return sign === "-" ? -v : v;
}

/** 最小单位整数 → "12.34" 展示字符串 */
export function formatMinor(cents: number, currency: string): string {
  if (isZeroDecimalCurrency(currency)) return String(cents);
  const neg = cents < 0;
  const abs = Math.abs(cents).toString().padStart(3, "0");
  const body = `${abs.slice(0, -2)}.${abs.slice(-2)}`;
  return neg ? `-${body}` : body;
}

/** 最小单位整数 → 符号 + 金额（如 "$12.34"） */
export function formatMoney(cents: number, currency: string): string {
  const symbols: Record<string, string> = { USD: "$", CNY: "¥", EUR: "€", GBP: "£", JPY: "¥" };
  const sym = symbols[currency.toUpperCase()] ?? `${currency} `;
  return `${sym}${formatMinor(cents, currency)}`;
}

/** 最小单位 → 网关 JSON number（两位小数可精确往返；零小数币种原样） */
export function minorToNumber(cents: number, currency: string): number {
  if (isZeroDecimalCurrency(currency)) return cents;
  return cents / 100;
}
