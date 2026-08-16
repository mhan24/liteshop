import { ref } from 'vue'
import { api } from '@/shared/api/client'

// 站点级货币/时区配置（供海外市场使用），从 /admin/site 加载。
const siteCfg = ref<any>({})

export async function loadSiteFormat() {
  try {
    const data = await api.get('/admin/site')
    siteCfg.value = {
      currency: data.site_currency || 'CNY',
      symbol: symbolFor(data.site_currency),
      timezone: data.site_timezone || 'Asia/Shanghai',
      locale: data.site_locale || 'zh-CN',
    }
  } catch {
    siteCfg.value = { currency: 'CNY', symbol: '¥', timezone: 'Asia/Shanghai', locale: 'zh-CN' }
  }
}

export function symbolFor(currency: string): string {
  const c = (currency || '').toUpperCase()
  if (c === 'CNY' || c === 'RMB' || c === 'JPY') return '¥'
  if (c === 'USD') return '$'
  if (c === 'EUR') return '€'
  if (c === 'GBP') return '£'
  return c || '¥'
}

// 金额格式化: 符号 + 数值
export function fmtMoney(cents?: number): string {
  return siteCfg.value.symbol + ((cents || 0) / 100).toFixed(2)
}

// 金额 + 代码
export function fmtMoneyCode(cents?: number): string {
  return siteCfg.value.symbol + ((cents || 0) / 100).toFixed(2) + ' ' + siteCfg.value.currency
}

// 货币符号 + 代码, 如 "¥ CNY"
export function currencyLabel(): string {
  return siteCfg.value.symbol + ' ' + siteCfg.value.currency
}

// 时间格式化（站点时区）
export function fmtDate(ts?: number): string {
  if (!ts) return '-'
  try {
    return new Date(ts * 1000).toLocaleString(siteCfg.value.locale, { timeZone: siteCfg.value.timezone })
  } catch {
    return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
  }
}
