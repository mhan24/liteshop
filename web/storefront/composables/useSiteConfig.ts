import { computed, ref } from 'vue'
import { formatDate, formatMoney, stockText as sharedStockText } from '@/shared/formatting'

// 站点级 i18n / 货币 / 时区配置（供未来多语言与海外市场使用）。
// 数据来自 /api/v1/site 的 locale / currency / currency_symbol / timezone。
const siteConfig = ref<any>({})

export function loadSiteConfig(config: any) {
  siteConfig.value = config || {}
}

export function useSiteConfig() {
  const site = siteConfig
  const locale = computed(() => siteConfig.value.locale || 'zh-CN')
  const currency = computed(() => siteConfig.value.currency || 'CNY')
  const symbol = computed(() => siteConfig.value.currency_symbol || '¥')
  const timezone = computed(() => siteConfig.value.timezone || 'Asia/Shanghai')
  const stockDisplay = computed(() => siteConfig.value.stock_display_mode || 'exact')

  // 库存显示：exact 显示精确数；fuzzy 显示 充足/紧张/售罄
  function stockText(available: number): string {
    return sharedStockText(available, stockDisplay.value)
  }

  // 金额格式化: 返回符号 + 数值 (两位小数)
  function money(cents?: number): string {
    return formatMoney(cents, symbol.value)
  }

  // 金额 + 货币代码
  function moneyWithCode(cents?: number): string {
    return money(cents) + ' ' + currency.value
  }

  // 时间格式化 (使用站点时区)
  function date(ts?: number): string {
    return formatDate(ts, locale.value, timezone.value)
  }

  return { site, locale, currency, symbol, timezone, stockDisplay, stockText, money, moneyWithCode, date }
}
