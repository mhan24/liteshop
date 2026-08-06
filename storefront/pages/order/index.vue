<template>
  <div class="max-w-xl bg-white rounded-xl border p-6 shadow-sm">
    <h1 class="text-xl font-bold">{{ t('orderQuery') }}</h1>
    <p class="text-gray-500 text-sm mt-1">{{ t('forgotOrderNo') }}</p>
    <form class="mt-4 grid gap-3" @submit.prevent="submit">
      <div>
        <label class="text-sm font-semibold">{{ t('email') }}</label>
        <input type="email" v-model="form.contact" required class="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label class="text-sm font-semibold">{{ t('orderNoOptional') }}</label>
        <input v-model="form.order_no" :placeholder="t('orderNoOptionalHint')" class="w-full border rounded px-3 py-2" />
      </div>
      <button type="submit" :disabled="loading" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold disabled:opacity-60">
        {{ form.order_no ? t('queryOrder') : t('recoverByEmail') }}
      </button>
    </form>
    <p class="text-xs text-gray-400 mt-2">{{ t('orderLinkHint') }}</p>

    <div v-if="orders.length" class="mt-5 divide-y">
      <div v-for="(item, idx) in orders" :key="idx" class="py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-semibold">{{ item.product_name }} x{{ item.qty }}</div>
          <div class="text-sm text-gray-500">
            <span>{{ orderSub(item) }} · {{ date(item.paid_at || item.created_at) }}</span>
          </div>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="badgeClass(item.status)">{{ statusText(item.status) }}</span>
        </div>
        <div class="flex gap-2">
          <a v-if="item.payment_url" :href="item.payment_url" class="text-brand font-semibold">{{ t('continuePay') }}</a>
        </div>
      </div>
    </div>
    <div v-if="searched" class="mt-4">
      <button class="text-sm text-brand font-semibold" @click="sendAllLinks">{{ t('sendAllLinks') }}</button>
    </div>
    <div ref="turnstileContainer" v-if="turnstilePending" class="mt-3"></div>
    <div v-else-if="searched && !loading" class="text-gray-500 mt-5">{{ t('noOrders') }}</div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const { date: siteDate } = useSiteConfig()
const api = useApi()
const form = reactive({ contact: '', order_no: '' })
const orders = ref<any[]>([])
const loading = ref(false)
const searched = ref(false)
const turnstileSiteKey = ref('')
const turnstileWidget = ref<any>(null)
const turnstileContainer = ref<HTMLElement | null>(null)
const turnstilePending = ref(false)
const pendingAction = ref<'lookup' | 'links'>('lookup')

const { data: site } = await useAsyncData('order-site', () => api.get('/site').catch(() => null))
turnstileSiteKey.value = (site.value as any)?.turnstile_site_key || ''

function ensureTurnstileScript() {
  if (!turnstileSiteKey.value) return
  if (!document.getElementById('turnstile-api')) {
    const s = document.createElement('script')
    s.id = 'turnstile-api'
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js'
    s.async = true
    s.defer = true
    document.head.appendChild(s)
  }
}

function renderTurnstile() {
  const poll = () => {
    if (window.turnstile && turnstileContainer.value) {
      turnstileWidget.value = window.turnstile.render(turnstileContainer.value, {
        sitekey: turnstileSiteKey.value,
        action: 'order-lookup',
        callback: (token: string) => {
          turnstilePending.value = false
          if (pendingAction.value === 'links') {
            doSendAllLinks(token)
          } else {
            doLookup(token)
          }
        },
      })
    } else {
      setTimeout(poll, 200)
    }
  }
  poll()
}

async function submit() {
  if (!form.contact) return
  if (turnstileSiteKey.value) {
    pendingAction.value = 'lookup'
    turnstilePending.value = true
    ensureTurnstileScript()
    await nextTick()
    renderTurnstile()
    return
  }
  await doLookup('')
}

async function doLookup(token: string) {
  if (form.order_no) {
    await navigateTo({ path: `/order/${form.order_no}`, query: { contact: form.contact } })
    return
  }
  loading.value = true
  searched.value = true
  orders.value = []
  try {
    const data: any = await api.get('/orders', {
      contact: form.contact,
    }, token ? { 'X-Turnstile-Response': token } : undefined)
    orders.value = data.orders || []
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('queryFail'))
  } finally {
    loading.value = false
  }
}
async function sendAllLinks() {
  if (turnstileSiteKey.value) {
    pendingAction.value = 'links'
    turnstilePending.value = true
    ensureTurnstileScript()
    await nextTick()
    renderTurnstile()
    return
  }
  await doSendAllLinks('')
}

async function doSendAllLinks(token: string) {
  try {
    await api.post('/orders/links', { contact: form.contact }, token ? { 'X-Turnstile-Response': token } : undefined)
    alert(t('linkSent'))
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('linkFail'))
  }
}
function orderSub(item: any) {
  return ['paid', 'processing', 'delivered', 'completed'].includes(item.status)
    ? t('paidOrderSent')
    : t('orderSubPending')
}
function date(ts: number) {
  return siteDate(ts)
}
function statusText(status: string) {
  return (t(`orderStatus.${status}`) as string) || status
}
function badgeClass(status: string) {
  const m: any = {
    paid: 'bg-green-100 text-green-700', processing: 'bg-green-100 text-green-700',
    delivered: 'bg-green-100 text-green-700', completed: 'bg-green-100 text-green-700',
    waiting_payment: 'bg-yellow-100 text-yellow-700', created: 'bg-gray-100 text-gray-600',
    expired: 'bg-red-100 text-red-700', payment_failed: 'bg-red-100 text-red-700',
    delivery_failed: 'bg-red-100 text-red-700', cancelled: 'bg-gray-100 text-gray-600',
  }
  return m[status] || 'bg-gray-100 text-gray-600'
}
useHead({ title: t('orderQuery'), meta: [{ name: 'description', content: t('orderQueryDesc') }, { name: 'robots', content: 'noindex,nofollow' }] })
</script>
