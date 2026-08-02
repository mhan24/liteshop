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
      <p class="text-2xl font-bold mt-4">¥{{ money(product.price_cents) }}</p>
      <p class="text-gray-500 text-sm">{{ t('currentStock') }} {{ available }}</p>

      <form class="mt-4 grid gap-3" @submit.prevent="submit">
        <div v-if="tradeTypes.length > 1">
          <label class="text-sm font-semibold">{{ t('network') }}</label>
          <select v-model="form.trade_type" class="w-full border rounded px-3 py-2">
            <option v-for="t in tradeTypes" :key="t" :value="t">{{ t }}</option>
          </select>
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('quantity') }}</label>
          <input type="number" v-model.number="form.qty" :min="1" :max="available" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('email') }}</label>
          <input type="email" v-model="form.contact" required class="w-full border rounded px-3 py-2" />
        </div>
        <div ref="turnstile" class="cf-turnstile"></div>
        <button type="submit" :disabled="loading" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold disabled:opacity-60">
          {{ loading ? t('processing') : t('payNow') }}
        </button>
      </form>
    </div>
    <div v-else class="py-10 text-gray-500">{{ t('productNotFound') }}</div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const api = useApi()
const req = useRequestURL()

// URL 形如 /product/123-slug，解析出纯数字 id；也兼容旧格式 /product/123
const productId = computed(() => {
  const raw = String(route.params.id || '')
  const m = raw.match(/^(\d+)/)
  return m ? m[1] : raw
})
const pageUrl = computed(() => req.origin + route.path)
const { data, pending } = await useAsyncData(() => api.get('/products/' + productId.value).catch(() => null))
const product = computed(() => (data.value as any)?.product)
const available = computed(() => (data.value as any)?.available || 0)
const tradeTypes = computed(() => (data.value as any)?.trade_types || [])
const turnstileSiteKey = computed(() => (data.value as any)?.turnstile_site_key || '')
const form = reactive({ trade_type: '', qty: 1, contact: '' })
const loading = ref(false)

watchEffect(() => { if (!form.trade_type && tradeTypes.value.length) form.trade_type = tradeTypes.value[0] })

const turnstileWidget = ref<any>(null)

function loadTurnstile() {
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
  const poll = () => {
    if (window.turnstile && document.querySelector('.cf-turnstile')) {
      if (turnstileWidget.value) {
        window.turnstile.reset(turnstileWidget.value)
        return
      }
      turnstileWidget.value = window.turnstile.render(document.querySelector('.cf-turnstile') as HTMLElement, {
        sitekey,
        action: 'turnstile-spin-v2',
      })
    } else {
      setTimeout(poll, 200)
    }
  }
  poll()
}

onMounted(loadTurnstile)
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
  return url || (data.value as any)?.default_product_image || 'https://storage.moegirl.org.cn/moegirl/commons/0/0d/%E8%B1%86%E5%8C%85AI.png'
}
async function submit() {
  loading.value = true
  try {
    const tokenInput = document.querySelector('[name="cf-turnstile-response"]') as HTMLInputElement | null
    const res: any = await api.post('/orders', {
      product_id: Number(productId.value),
      qty: form.qty,
      contact: form.contact,
      trade_type: form.trade_type,
      'cf-turnstile-response': tokenInput?.value || '',
    })
    if (res.payment_url) {
      window.open(res.payment_url, '_blank', 'noopener')
      window.location.href = '/order/' + res.order_no + '?contact=' + encodeURIComponent(form.contact)
    }
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('createOrderFail'))
  } finally {
    loading.value = false
  }
}
useHead(() => {
  const p = product.value
  const siteName = (data.value as any)?.site_title || ''
  const desc = markdownText(p?.description).slice(0, 160)
  const img = imgSrc(p?.image_url)
  const slug = p?.slug ? '-' + encodeURIComponent(p.slug) : ''
  const canonical = req.origin + '/product/' + (p?.id ?? productId.value) + slug
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
                priceCurrency: 'CNY',
                price: ((p.price_cents || 0) / 100).toFixed(2),
                availability: available.value > 0 ? 'https://schema.org/InStock' : 'https://schema.org/OutOfStock',
              },
            }),
          },
        ]
      : [],
  }
})
</script>
