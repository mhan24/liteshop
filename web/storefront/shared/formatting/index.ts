// 通用格式化（货币/时间），由展示层调用。
export function formatMoney(cents: number | undefined, symbol: string): string {
  return symbol + ((cents || 0) / 100).toFixed(2)
}

export function formatDate(ts: number | undefined, locale: string, timezone: string): string {
  if (!ts) return '-'
  try {
    return new Date(ts * 1000).toLocaleString(locale, { timeZone: timezone })
  } catch {
    return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  }
}

export function stockText(available: number, mode: string): string {
  if (mode === 'fuzzy') {
    if (available <= 0) return 'soldout'
    if (available <= 10) return 'tight'
    return 'plenty'
  }
  return String(available)
}
