/**
 * 金额处理（PLAN §8：金额内部一律整数分，禁浮点运算）。
 *
 * - toCents：边界转换唯一入口。字符串按十进制解析（无浮点参与）；
 *   number 输入先经 String() 转十进制字符串——JS Number→String 是最短
 *   往返表示，与 Go fmt.Sprintf("%v") 对 float64 的输出一致（bepusdt
 *   签名依赖这一点，见 lib/signature.ts）。
 * - 超过 2 位小数时四舍五入到分（防御上游舍入伪影，正常业务不会出现）。
 */

const DECIMAL_RE = /^([+-]?)(\d+)(?:\.(\d+))?$/;

export class MoneyParseError extends Error {}

export function toCents(input: string | number): bigint {
  let s: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new MoneyParseError(`非法金额: ${input}`);
    s = String(input);
  } else {
    s = input.trim();
  }

  const m = DECIMAL_RE.exec(s);
  if (!m) throw new MoneyParseError(`非法金额: ${input}`);

  const [, sign, intPart, fracRaw = ""] = m;
  // 四舍五入到 2 位小数（纯字符串运算）
  let frac = fracRaw.slice(0, 2).padEnd(2, "0");
  const rest = fracRaw.slice(2);
  if (rest.length > 0) {
    // 只需看第 3 位决定进位（后续位不影响 half-up 语义）
    if (rest[0] >= "5") {
      frac = String(BigInt(frac) + 1n).padStart(2, "0");
      if (frac.length > 2) {
        // 进位到整数部分
        const carry = BigInt(frac.slice(0, frac.length - 2));
        frac = frac.slice(-2);
        return withSign(sign, BigInt(intPart) * 100n + BigInt(frac) + carry * 100n);
      }
    }
  }
  return withSign(sign, BigInt(intPart) * 100n + BigInt(frac));
}

function withSign(sign: string, cents: bigint): bigint {
  return sign === "-" ? -cents : cents;
}

/** 分 → "42.50" 展示/传输格式（纯字符串，无浮点） */
export function formatCents(cents: bigint): string {
  const neg = cents < 0n;
  const abs = (neg ? -cents : cents).toString().padStart(3, "0");
  const body = `${abs.slice(0, -2)}.${abs.slice(-2)}`;
  return neg ? `-${body}` : body;
}

/** 分 → 传输用数值（bepusdt amount 参数为 JSON number；两位小数值可精确往返） */
export function centsToNumber(cents: bigint): number {
  return Number(formatCents(cents));
}

/** 站点支持的币种（与 bepusdt fiat 对齐：CNY/USD/EUR/GBP/JPY） */
export const SUPPORTED_CURRENCIES = ["USD", "CNY", "EUR", "GBP", "JPY"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  CNY: "¥",
  EUR: "€",
  GBP: "£",
  JPY: "¥",
};

export function currencySymbol(code: string): string {
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? "";
}

/** 金额展示统一入口："$9.90"；未知币种回退 "CODE 9.90" */
export function formatMoney(cents: bigint, currency: string): string {
  const code = currency.toUpperCase();
  const sym = CURRENCY_SYMBOLS[code];
  const amount = formatCents(cents);
  return sym ? `${sym}${amount}` : `${code} ${amount}`;
}

/** 等值金额字符串归一化（"12.3400"→"12.34"、"12"→"12"），用于 actual_amount 对账 */
export function normalizeAmountString(value: string): string {
  const s = value.trim();
  if (!s.includes(".")) return s;
  const trimmed = s.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
