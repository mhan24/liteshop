<template>
  <div class="max-w-xl bg-white rounded-xl border p-6 shadow-sm">
    <NuxtLink to="/" class="text-sm text-gray-500">{{ t('backProducts') }}</NuxtLink>
    <div v-if="pending" class="py-10 text-gray-400">{{ t('loading') }}</div>
    <div v-else-if="product">
      <div class="aspect-square w-full overflow-hidden rounded-xl bg-gray-100">
        <img :src="imgSrc(product.image_url)" :alt="product.name" class="w-full h-full object-cover" />
      </div>
      <h1 class="text-2xl font-bold mt-3">{{ product.name }}</h1>
      <div class="md-body text-gray-600 mt-2" v-html="renderMarkdown(product.description)"></div>
      <p class="text-2xl font-bold mt-4">{{ siteMoney(product.price_cents) }}</p>
      <p class="text-gray-500 text-sm">{{ t('currentStock') }} {{ stockLabel(available) }}</p>

      <div v-if="wholesale.length" class="mt-3 border rounded-lg overflow-hidden">
        <table class="w-full text-sm">
          <thead>
            <tr class="bg-gray-50">
              <th class="text-left px-3 py-2">{{ t('wholesaleQty') }}</th>
              <th class="text-left px-3 py-2">{{ t('wholesalePrice') }}</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="t in wholesale" :key="t.min_qty" class="border-t">
              <td class="px-3 py-2">{{ t('wholesaleFrom') }} {{ t.min_qty }}</td>
              <td class="px-3 py-2">{{ siteMoney(wholesalePrice(t.min_qty)) }}<span v-if="t.discount < 100" class="text-red-500 text-xs ml-1">{{ t.discount }}%</span></td>
            </tr>
          </tbody>
        </table>
      </div>

      <form class="mt-4 grid gap-3" @submit.prevent="submit">
        <div v-if="tradeTypes.length > 1">
          <label class="text-sm font-semibold">{{ t('network') }}</label>
          <div class="grid grid-cols-2 gap-2 mt-1">
            <button
              type="button"
              v-for="t in tradeTypes"
              :key="t"
              :class="[
                'border rounded-lg px-3 py-2.5 text-left transition',
                form.trade_type === t
                  ? 'border-brand bg-brand/5 ring-1 ring-brand'
                  : 'border-gray-200 hover:border-gray-400',
              ]"
              @click="form.trade_type = t"
            >
              <span class="block font-semibold text-sm">{{ networkName(t) }}</span>
              <span class="block text-xs text-gray-500 mt-0.5">{{ networkCoin(t) }}</span>
            </button>
          </div>
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('quantity') }} ({{ minQty }}-{{ maxQty }})</label>
          <input type="number" v-model.number="form.qty" :min="minQty" :max="maxQty" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('couponCode') }}</label>
          <input v-model="form.coupon_code" :placeholder="t('couponPlaceholder')" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('email') }}</label>
          <input type="email" v-model="form.contact" required class="w-full border rounded px-3 py-2" />
        </div>
        <button type="submit" :disabled="loading" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold disabled:opacity-60">
          {{ loading ? t('processing') : t('payNow') }}
        </button>
      </form>

      <div v-if="faqItems.length" class="mt-8">
        <h2 class="text-lg font-bold mb-3">{{ t('faqTitle') }}</h2>
        <div class="divide-y border rounded-lg">
          <details v-for="(item, idx) in faqItems" :key="idx" class="px-4 py-3">
            <summary class="font-semibold cursor-pointer select-none">{{ item.q }}</summary>
            <div class="md-body text-gray-600 mt-2 text-sm" v-html="renderMarkdown(item.a)"></div>
          </details>
        </div>
      </div>
    </div>
    <div v-else class="py-10 text-gray-500">{{ t('productNotFound') }}</div>

    <div v-if="turnstileOpen" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-sm text-center">
        <h2 class="text-lg font-bold">{{ t('verifyTitle') }}</h2>
        <p class="text-sm text-gray-500 mt-1">{{ t('verifyHint') }}</p>
        <div ref="turnstileContainer" class="cf-turnstile mt-4 flex justify-center"></div>
        <p v-if="turnstileError" class="text-red-600 text-sm mt-2">{{ t('verifyRetry') }}</p>
        <button type="button" class="mt-4 text-sm text-gray-500 hover:text-gray-800" @click="closeTurnstile">{{ t('verifyCancel') }}</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { money: siteMoney, currency: siteCurrency, stockText } = useSiteConfig()
const api = useApi()
const origin = useSiteOrigin()

// URL 形如 /product/{slug} 或 /product/{id}，直接传给 API 由后端按 slug/id 查找
const productKey = computed(() => String(route.params.id || ''))
const pageUrl = computed(() => origin.value + route.path)
const { data, pending } = await useAsyncData(() => api.get('/products/' + productKey.value).catch(() => null))
const product = computed(() => (data.value as any)?.product)
const faqItems = computed(() => (product.value?.faq || []) as any[])
const wholesale = computed(() => (product.value?.wholesale || []) as any[])
const minQty = computed(() => product.value?.min_qty || 1)
const maxQty = computed(() => Math.min(product.value?.max_qty || 100, available.value || 100))
const available = computed(() => (data.value as any)?.available || 0)
function stockLabel(n: number) {
  const s = stockText(n)
  if (s === 'plenty') return t('stockPlenty')
  if (s === 'tight') return t('stockTight')
  if (s === 'soldout') return t('stockSoldout')
  return s
}
function wholesalePrice(minQtyNum: number) {
  const base = product.value?.price_cents || 0
  const tier = (wholesale.value as any[]).find((t) => t.min_qty === minQtyNum)
  const discount = tier?.discount || 100
  return Math.round((base * discount) / 100)
}
const tradeTypes = computed(() => (data.value as any)?.trade_types || [])
// trade_type 形如 usdt.trc20 → 币种 USDT / 网络 TRC20；未知格式原样展示
const networkCoin = computed(() => (t: string) => {
  const coin = t.split('.')[0]
  return coin ? coin.toUpperCase() : t
})
const networkName = computed(() => (t: string) => {
  const net = t.split('.')[1]
  return net ? net.toUpperCase() : t
})
const turnstileSiteKey = computed(() => (data.value as any)?.turnstile_site_key || '')
const form = reactive({ trade_type: '', qty: 1, contact: '', coupon_code: '' })
const loading = ref(false)

watchEffect(() => { if (!form.trade_type && tradeTypes.value.length) form.trade_type = tradeTypes.value[0] })

const turnstileWidget = ref<any>(null)
const turnstileOpen = ref(false)
const turnstileError = ref(false)
const turnstileContainer = ref<HTMLElement | null>(null)
let turnstilePending = false

function ensureTurnstileScript() {
  const sitekey = turnstileSiteKey.value
  if (!sitekey) return
  const id = 'turnstile-api'
  if (!document.getElementById(id)) {
    const s = document.createElement('script')
    s.id = id
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    s.defer = true
    document.head.appendChild(s)
  }
}

function renderTurnstile() {
  const sitekey = turnstileSiteKey.value
  if (!sitekey) return
  const poll = () => {
    if (window.turnstile && turnstileContainer.value) {
      if (turnstileWidget.value) {
        window.turnstile.reset(turnstileWidget.value)
        return
      }
      turnstileWidget.value = window.turnstile.render(turnstileContainer.value, {
        sitekey,
        action: 'turnstile-spin-v2',
        callback: (token: string) => {
          turnstileError.value = false
          closeTurnstile()
          if (turnstilePending) {
            turnstilePending = false
            createOrder(token)
          }
        },
      })
    } else {
      setTimeout(poll, 200)
    }
  }
  poll()
}

function openTurnstile() {
  turnstileError.value = false
  turnstileOpen.value = true
  turnstilePending = true
  ensureTurnstileScript()
  nextTick(renderTurnstile)
}

function closeTurnstile() {
  turnstileOpen.value = false
  if (window.turnstile && turnstileWidget.value) {
    window.turnstile.remove(turnstileWidget.value)
    turnstileWidget.value = null
  }
}

onBeforeUnmount(() => {
  if (window.turnstile && turnstileWidget.value) {
    window.turnstile.remove(turnstileWidget.value)
    turnstileWidget.value = null
  }
})

function money(c?: number) {
  return ((c || 0) / 100).toFixed(2)
}
function imgSrc(url: string) {
  return url || (data.value as any)?.default_product_image || '/default-product.svg'
}
async function submit() {
  if (loading.value) return
  openTurnstile()
}

async function createOrder(token: string) {
  loading.value = true
  try {
    const res: any = await api.post('/orders', {
      product_id: Number(product.value?.id),
      qty: form.qty,
      contact: form.contact,
      trade_type: form.trade_type,
      coupon_code: form.coupon_code.trim(),
      'cf-turnstile-response': token,
    })
    if (res.order_no) {
      if (res.payment_url) window.open(res.payment_url, '_blank', 'noopener')
      const q = res.token
        ? 'token=' + encodeURIComponent(res.token)
        : 'contact=' + encodeURIComponent(form.contact)
      window.location.href = '/order/' + res.order_no + '?' + q
    }
  } catch (e: any) {
    const msg = e?.data?.error || e?.message || ''
    if (msg.includes('turnstile') || msg.includes('captcha')) {
      openTurnstile()
    } else {
      alert(msg || t('createOrderFail'))
    }
  } finally {
    loading.value = false
  }
}
useHead(() => {
  const p = product.value
  const siteName = (data.value as any)?.site_title || ''
  const desc = markdownText(p?.description).slice(0, 160)
  const img = imgSrc(p?.image_url)
  const canonicalSlug = p?.slug && p.slug !== 'p' ? encodeURIComponent(p.slug) : (p?.id ?? '')
  const canonical = origin.value + '/product/' + canonicalSlug
  const url = pageUrl.value
  return {
    title: p?.name || t('product'),
    meta: [
      { name: 'description', content: desc },
      { property: 'og:type', content: 'product' },
      { property: 'og:title', content: p?.name || t('product') },
      { property: 'og:description', content: desc },
      { property: 'og:url', content: canonical },
      { property: 'og:image', content: img },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    link: [{ rel: 'canonical', href: canonical }],
    script: p
      ? [
          {
            type: 'application/ld+json',
            children: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Product',
              name: p.name,
              description: p.description,
              sku: String(p.id),
              image: img,
              url: canonical,
              ...(siteName ? { brand: { '@type': 'Brand', name: siteName } } : {}),
              offers: {
                '@type': 'Offer',
                url,
                priceCurrency: siteCurrency.value,
                price: ((p.price_cents || 0) / 100).toFixed(2),
                availability: available.value > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
              },
            }),
          },
          ...(faqItems.value.length
            ? [
                {
                  type: 'application/ld+json',
                  children: JSON.stringify({
                    '@context': 'https://schema.org',
                    '@type': 'FAQPage',
                    mainEntity: faqItems.value.map((f: any) => ({
                      '@type': 'Question',
                      name: f.q,
                      acceptedAnswer: { '@type': 'Answer', text: markdownText(f.a) },
                    })),
                  }),
                },
              ]
            : []),
        ]
      : [],
  }
})
</script>
