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

/**
 * 按币种的「最小单位」解析金额（边界转换的唯一正确入口）。
 *
 * - 两位小数币种（USD/CNY/EUR/GBP）：输入 9.9 → 990（分）
 * - 零小数币种（JPY）：输入 1500 → 1500（日元，不做 /100）
 *
 * 历史缺陷：商品价格一律走 toCents，导致 JPY 商品「1500 日元」被存成
 * 150000（误当作分），展示与传给网关的金额都放大 100 倍。
 */
export function toMinorUnits(input: string | number, currency: string): bigint {
  if (!isZeroDecimalCurrency(currency)) return toCents(input);
  // 零小数币种：直接按整数解析，拒绝小数（日元没有 0.5 日元）
  const s = (typeof input === "number" ? String(input) : input).trim();
  const m = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(s);
  if (!m) throw new MoneyParseError(`非法金额: ${input}`);
  const [, sign, intPart, frac = ""] = m;
  if (frac !== "" && /[1-9]/.test(frac)) {
    throw new MoneyParseError(`${currency} 不支持小数金额: ${input}`);
  }
  const v = BigInt(intPart);
  return sign === "-" ? -v : v;
}

/** 最小单位 → 传输给网关的数值（JPY 直接输出日元数，不除 100） */
export function minorUnitsToNumber(minor: bigint, currency: string): number {
  return isZeroDecimalCurrency(currency) ? Number(minor) : centsToNumber(minor);
}

/** 站点支持的币种（与 bepusdt fiat 对齐：CNY/USD/EUR/GBP/JPY） */
export const SUPPORTED_CURRENCIES = ["USD", "CNY", "EUR", "GBP", "JPY"] as const;
export type CurrencyCode = (typeof SUPPORTED_CURRENCIES)[number];

/**
 * 零小数币种（无「分」概念）。JPY 最小单位就是 1 日元。
 * 内部仍统一用「整数最小单位」存储（JPY 的 cents == 日元），
 * 只是展示与传输时不能除以 100。
 */
const ZERO_DECIMAL_CURRENCIES = new Set(["JPY"]);

export function isZeroDecimalCurrency(code: string): boolean {
  return ZERO_DECIMAL_CURRENCIES.has(code.toUpperCase());
}

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

/** 金额展示统一入口："$9.90"；JPY 无小数（"¥1500"）；未知币种回退 "CODE 9.90" */
export function formatMoney(cents: bigint, currency: string): string {
  const code = currency.toUpperCase();
  const sym = CURRENCY_SYMBOLS[code];
  // 零小数币种：内部最小单位即主单位，不补两位小数
  const amount = isZeroDecimalCurrency(code) ? cents.toString() : formatCents(cents);
  return sym ? `${sym}${amount}` : `${code} ${amount}`;
}

/** 等值金额字符串归一化（"12.3400"→"12.34"、"12"→"12"），用于 actual_amount 对账 */
export function normalizeAmountString(value: string): string {
  const s = value.trim();
  if (!s.includes(".")) return s;
  const trimmed = s.replace(/0+$/, "").replace(/\.$/, "");
  return trimmed === "" || trimmed === "-" ? "0" : trimmed;
}
