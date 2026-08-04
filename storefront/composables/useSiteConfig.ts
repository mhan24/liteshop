import { computed, ref } from 'vue'

// 站点级 i18n / 货币 / 时区配置（供未来多语言与海外市场使用）。
// 数据来自 /api/v1/site 的 locale / currency / currency_symbol / timezone。
const siteConfig = ref<any>({})

export function loadSiteConfig(config: any) {
  siteConfig.value = config || {}
}

export function useSiteConfig() {
  const locale = computed(() => siteConfig.value.locale || 'zh-CN')
  const currency = computed(() => siteConfig.value.currency || 'CNY')
  const symbol = computed(() => siteConfig.value.currency_symbol || '¥')
  const timezone = computed(() => siteConfig.value.timezone || 'Asia/Shanghai')
  const stockDisplay = computed(() => siteConfig.value.stock_display_mode || 'exact')

  // 库存显示：exact 显示精确数；fuzzy 显示 充足/紧张/售罄
  function stockText(available: number): string {
    if (stockDisplay.value === 'fuzzy') {
      if (available <= 0) return 'soldout'
      if (available <= 10) return 'tight'
      return 'plenty'
    }
    return String(available)
  }

  // 金额格式化: 返回符号 + 数值 (两位小数)
  function money(cents?: number): string {
    const v = ((cents || 0) / 100).toFixed(2)
    return symbol.value + v
  }

  // 金额 + 货币代码
  function moneyWithCode(cents?: number): string {
    return money(cents) + ' ' + currency.value
  }

  // 时间格式化 (使用站点时区)
  function date(ts?: number): string {
    if (!ts) return '-'
    try {
      return new Date(ts * 1000).toLocaleString(locale.value, { timeZone: timezone.value })
    } catch {
      return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
    }
  }

  return { locale, currency, symbol, timezone, stockDisplay, stockText, money, moneyWithCode, date }
}
