<template>
  <div class="max-w-xl card bg-base-100 shadow-sm">
    <div class="card-body">
    <h1 class="text-xl font-bold text-base-content">{{ t('orderQuery') }}</h1>
    <p class="text-base-content/60 text-sm mt-1">{{ t('forgotOrderNo') }}</p>
    <form class="mt-4 grid gap-3" @submit.prevent="submit">
      <div>
        <label class="text-sm font-semibold text-base-content">{{ t('email') }}</label>
        <input type="email" v-model="form.contact" required class="input input-bordered w-full mt-1" />
      </div>
      <div>
        <label class="text-sm font-semibold text-base-content">{{ t('orderNoOptional') }}</label>
        <input v-model="form.order_no" :placeholder="t('orderNoOptionalHint')" class="input input-bordered w-full mt-1" />
      </div>
      <button type="submit" :disabled="loading" class="btn btn-primary normal-case disabled:opacity-60">
        {{ form.order_no ? t('queryOrder') : t('recoverByEmail') }}
      </button>
    </form>
    <p class="text-xs text-base-content/40 mt-2">{{ t('orderLinkHint') }}</p>

    <div v-if="orders.length" class="mt-5 divide-y divide-base-200">
      <div v-for="(item, idx) in orders" :key="idx" class="py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-semibold">{{ item.product_name }} x{{ item.qty }}</div>
          <div class="text-sm text-base-content/60">
            <span>{{ orderSub(item) }} · {{ date(item.paid_at || item.created_at) }}</span>
          </div>
          <span class="badge badge-sm" :class="badgeClass(item.status)">{{ statusText(item.status) }}</span>
        </div>
        <div class="flex gap-2">
          <a v-if="item.payment_url" :href="item.payment_url" class="link link-primary font-semibold">{{ t('continuePay') }}</a>
        </div>
      </div>
    </div>
    <div v-if="searched" class="mt-4">
      <button class="btn btn-link btn-sm link-primary px-0" @click="sendAllLinks">{{ t('sendAllLinks') }}</button>
    </div>
    <div ref="turnstileContainer" v-if="turnstilePending" class="mt-3"></div>
    <div v-else-if="searched && !loading" class="text-base-content/60 mt-5">{{ t('noOrders') }}</div>
    </div>
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
    paid: 'badge-success', processing: 'badge-success',
    delivered: 'badge-success', completed: 'badge-success',
    waiting_payment: 'badge-warning', created: 'badge-neutral',
    expired: 'badge-error', payment_failed: 'badge-error',
    delivery_failed: 'badge-error', cancelled: 'badge-neutral',
  }
  return m[status] || 'badge-neutral'
}
useHead({ title: t('orderQuery'), meta: [{ name: 'description', content: t('orderQueryDesc') }, { name: 'robots', content: 'noindex,nofollow' }] })
</script>
