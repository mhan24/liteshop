<template>
  <div class="flex flex-col lg:flex-row lg:items-start lg:gap-8">
    <div class="w-full max-w-xl">
      <Button as-child variant="ghost" size="sm" class="mb-2 -ml-2">
        <NuxtLink to="/">{{ t('backProducts') }}</NuxtLink>
      </Button>
      <div v-if="pending" class="flex justify-center py-10">
        <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
      <Card v-else-if="product">
        <div class="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted">
          <img :src="imgSrc(product.image_url)" :alt="product.name" class="h-auto max-h-full w-auto max-w-full" />
        </div>
        <CardContent class="space-y-3">
          <h1 class="text-2xl font-bold">{{ product.name }}</h1>
          <div class="md-body text-muted-foreground" v-html="renderMarkdown(product.description)"></div>
          <p class="text-3xl font-extrabold text-primary">{{ siteMoney(product.price_cents) }}</p>
          <p class="text-sm text-muted-foreground">{{ t('currentStock') }} {{ stockLabel(available) }}</p>

          <div v-if="wholesale.length" class="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{{ t('wholesaleQty') }}</TableHead>
                  <TableHead>{{ t('wholesalePrice') }}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <TableRow v-for="t in wholesale" :key="t.min_qty">
                  <TableCell>{{ t('wholesaleFrom') }} {{ t.min_qty }}</TableCell>
                  <TableCell>
                    {{ siteMoney(wholesalePrice(t.min_qty)) }}
                    <Badge v-if="t.discount < 100" class="ml-1 bg-red-500/15 text-red-700"> {{ t.discount }}% </Badge>
                  </TableCell>
                </TableRow>
              </TableBody>
            </Table>
          </div>

          <form class="grid gap-3" @submit.prevent="submit">
            <div v-if="paymentGateways.length > 1">
              <label class="text-sm font-semibold">{{ t('paymentMethod') }}</label>
              <div class="mt-1 grid grid-cols-2 gap-2">
                <button
                  v-if="paymentGateways.includes('bepusdt')"
                  type="button"
                  :class="[
                    'rounded-lg border-2 bg-card px-3 py-2.5 text-left transition',
                    form.gateway === 'bepusdt'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50',
                  ]"
                  @click="form.gateway = 'bepusdt'"
                >
                  <span class="block text-sm font-semibold">{{ gatewayTitle('bepusdt') }}</span>
                  <span class="mt-0.5 block text-xs text-muted-foreground">{{ gatewayDesc('bepusdt') }}</span>
                </button>
                <button
                  v-if="paymentGateways.includes('hashpay')"
                  type="button"
                  :class="[
                    'rounded-lg border-2 bg-card px-3 py-2.5 text-left transition',
                    form.gateway === 'hashpay'
                      ? 'border-primary bg-primary/10'
                      : 'border-border hover:border-primary/50',
                  ]"
                  @click="form.gateway = 'hashpay'"
                >
                  <span class="block text-sm font-semibold">{{ gatewayTitle('hashpay') }}</span>
                  <span class="mt-0.5 block text-xs text-muted-foreground">{{ gatewayDesc('hashpay') }}</span>
                </button>
              </div>
            </div>
            <div v-if="form.gateway === 'bepusdt' && tradeTypes.length > 1">
              <label class="text-sm font-semibold">{{ t('network') }}</label>
              <div class="mt-1 grid grid-cols-2 gap-2">
                <button
                  type="button"
                  v-for="t in tradeTypes"
                  :key="t"
                  :class="[
                    'rounded-lg border-2 bg-card px-3 py-2.5 text-left transition',
                    form.trade_type === t ? 'border-primary bg-primary/10' : 'border-border hover:border-primary/50',
                  ]"
                  @click="form.trade_type = t"
                >
                  <span class="block text-sm font-semibold">{{ networkName(t) }}</span>
                  <span class="mt-0.5 block text-xs text-muted-foreground">{{ networkCoin(t) }}</span>
                </button>
              </div>
            </div>
            <div>
              <label class="text-sm font-semibold">{{ t('quantity') }} ({{ minQty }}-{{ maxQty }})</label>
              <Input v-model.number="form.qty" type="number" :min="minQty" :max="maxQty" class="mt-1" />
            </div>
            <div>
              <label class="text-sm font-semibold">{{ t('couponCode') }}</label>
              <Input v-model="form.coupon_code" :placeholder="t('couponPlaceholder')" class="mt-1" />
            </div>
            <div>
              <label class="text-sm font-semibold">{{ t('email') }}</label>
              <Input v-model="form.contact" type="email" required class="mt-1" />
            </div>
            <Button type="submit" class="w-full" :disabled="loading">
              <Loader2 v-if="loading" class="animate-spin" />
              {{ loading ? t('processing') : t('payNow') }}
            </Button>
          </form>

          <div v-if="faqItems.length">
            <h2 class="mb-2 text-lg font-bold">{{ t('faqTitle') }}</h2>
            <Accordion type="single" collapsible>
              <AccordionItem v-for="(item, idx) in faqItems" :key="idx" :value="'faq-' + idx">
                <AccordionTrigger class="text-left">{{ item.q }}</AccordionTrigger>
                <AccordionContent>
                  <div class="md-body text-sm text-muted-foreground" v-html="renderMarkdown(item.a)"></div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
          </div>
        </CardContent>
      </Card>
      <Card v-else>
        <CardContent class="py-8 text-center text-muted-foreground">{{ t('productNotFound') }}</CardContent>
      </Card>

      <Dialog :open="turnstileOpen" @update:open="turnstileOpen = $event">
        <DialogContent class="max-w-sm text-center">
          <DialogHeader>
            <DialogTitle>{{ t('verifyTitle') }}</DialogTitle>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">{{ t('verifyHint') }}</p>
          <!-- 注意：不要加 cf-turnstile 类（会触发 api.js 自动渲染，与下方显式 render 冲突） -->
          <div ref="turnstileContainer" class="mt-4 flex justify-center"></div>
          <p v-if="turnstileError" class="mt-2 text-sm text-destructive">{{ t('verifyRetry') }}</p>
          <Button variant="ghost" size="sm" class="mt-2" @click="closeTurnstile">
            {{ t('verifyCancel') }}
          </Button>
        </DialogContent>
      </Dialog>
    </div>

    <aside v-if="showQr" class="mt-6 w-60 shrink-0 lg:sticky lg:top-6 lg:mt-0">
      <Card class="text-center">
        <CardContent class="space-y-3 p-5">
          <p class="text-sm font-semibold">{{ t('scanTitle') }}</p>
          <div class="rounded-lg bg-muted p-2">
            <img v-if="qrDataUrl" :src="qrDataUrl" alt="QR" class="block h-auto w-full" />
          </div>
          <p class="text-xs text-muted-foreground">{{ t('scanHint') }}</p>
        </CardContent>
      </Card>
    </aside>
  </div>
</template>

<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

const route = useRoute()
const { t } = useI18n()
const { money: siteMoney, currency: siteCurrency, stockText } = useSiteConfig()
const api = useApi()
const origin = useSiteOrigin()
const isMobile = useIsMobile()

// URL 形如 /product/{slug} 或 /product/{id}，直接传给 API 由后端按 slug/id 查找
const productKey = computed(() => String(route.params.id || ''))
const pageUrl = computed(() => origin.value + route.path)
const { data, pending } = await useAsyncData(() => api.get('/products/' + productKey.value).catch(() => null))
const product = computed(() => (data.value as any)?.product)

// 桌面端展示“手机扫一扫”二维码（手机端不展示）
const qrDataUrl = ref('')
const qrError = ref(false)
const showQr = computed(() => !!product.value && !isMobile.value && !!qrDataUrl.value)

async function generateQr() {
  if (qrDataUrl.value || qrError.value) return
  try {
    const { default: QRCode } = await import('qrcode')
    qrDataUrl.value = await QRCode.toDataURL(pageUrl.value, {
      width: 400,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#111111', light: '#ffffff' },
    })
  } catch {
    qrError.value = true
  }
}

watch([isMobile, product], ([m, p]) => {
  if (!m && p) generateQr()
})

onMounted(() => {
  if (!isMobile.value && product.value) generateQr()
})

const faqItems = computed(() => (product.value?.faq || []) as any[])
const wholesale = computed(() => (product.value?.wholesale || []) as any[])
const minQty = computed(() => product.value?.min_qty || 1)
const maxQty = computed(() => {
  // 人工交付商品（available=-1）无库存限制，直接使用商品最大购买量
  if (available.value < 0) return Math.max(product.value?.max_qty || 100, minQty.value)
  return Math.min(product.value?.max_qty || 100, available.value || 100)
})
const available = computed(() => (data.value as any)?.available || 0)
function stockLabel(n: number) {
  if (n < 0) return t('stockUnlimited')
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
// 启用的支付网关列表（双网关并存时由买家选择）。
const paymentGateways = computed(() => {
  const list: string[] = (data.value as any)?.payment_gateways || []
  return list.length ? list : [(data.value as any)?.payment_gateway || 'bepusdt']
})
// 网关自定义名称/简介（后台配置，空值回退默认文案）。
const gatewayMeta = computed(() => (data.value as any)?.payment_gateway_meta || {})
function gatewayTitle(gateway: string) {
  const name = gatewayMeta.value[gateway]?.name?.trim()
  if (name) return name
  return gateway === 'hashpay' ? t('gatewayHashpay') : t('gatewayBepusdt')
}
function gatewayDesc(gateway: string) {
  const desc = gatewayMeta.value[gateway]?.description?.trim()
  if (desc) return desc
  return gateway === 'hashpay' ? t('gatewayHashpayDesc') : t('gatewayBepusdtDesc')
}
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
const form = reactive({ gateway: '', trade_type: '', qty: 1, contact: '', coupon_code: '' })
const loading = ref(false)

watchEffect(() => {
  if (!form.gateway && paymentGateways.value.length) form.gateway = paymentGateways.value[0]
  if (!form.trade_type && tradeTypes.value.length) form.trade_type = tradeTypes.value[0]
})

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
      gateway: form.gateway,
      coupon_code: form.coupon_code.trim(),
      'cf-turnstile-response': token,
    })
    if (res.order_no) {
      if (res.payment_url) window.open(res.payment_url, '_blank', 'noopener')
      const q = res.token ? 'token=' + encodeURIComponent(res.token) : 'contact=' + encodeURIComponent(form.contact)
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
