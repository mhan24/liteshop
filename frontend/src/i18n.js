import { ref, computed } from 'vue'

const lang = ref(localStorage.getItem('lang') || 'zh')

export function useI18n() {
  function setLang(value) {
    if (value !== 'zh' && value !== 'en') return
    lang.value = value
    localStorage.setItem('lang', value)
    fetch('/api/v1/lang?lang=' + value, { method: 'POST' }).catch(() => {})
  }
  const t = computed(() => dictionary[lang.value] || dictionary.zh)
  function tr(key) {
    return (dictionary[lang.value] && dictionary[lang.value][key]) || dictionary.zh[key] || key
  }
  return { lang, setLang, t, tr }
}

const dictionary = {
  zh: {
    products: '商品',
    orderQuery: '订单查询',
    buyNow: '立即购买',
    soldOut: '已售罄',
    stock: '库存',
    quantity: '购买数量',
    email: '邮箱',
    payNow: '去支付',
    orderNo: '订单号',
    queryOrder: '查询订单',
    backHome: '返回首页',
  },
  en: {
    products: 'Products',
    orderQuery: 'Order lookup',
    buyNow: 'Buy now',
    soldOut: 'Sold out',
    stock: 'Stock',
    quantity: 'Quantity',
    email: 'Email',
    payNow: 'Pay now',
    orderNo: 'Order number',
    queryOrder: 'Query order',
    backHome: 'Home',
  },
}
