import { watch } from 'vue'
import { zhDict, enDict } from '../i18n'

export function useI18n() {
  const localeCookie = useCookie<string>('shop_locale', { default: () => 'zh' })
  const locale = useState<string>('shop_locale', () => (localeCookie.value === 'en' ? 'en' : 'zh'))

  watch(locale, (v) => {
    localeCookie.value = v
  })

  const t = (key: string): string => {
    const dict = locale.value === 'en' ? enDict : zhDict
    return dict[key] || key
  }
  const setLocale = (l: 'zh' | 'en') => {
    locale.value = l
  }
  return { t, locale, setLocale }
}
