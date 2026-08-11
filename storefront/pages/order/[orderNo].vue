<template>
  <div class="max-w-xl card bg-base-100 shadow-sm">
    <div class="card-body">
    <h1 class="text-xl font-bold text-base-content mb-3">{{ t('orderDetail') }}</h1>
    <dl class="grid grid-cols-3 gap-2 text-sm">
      <dt class="text-base-content/60">{{ t('orderNo') }}</dt><dd class="col-span-2 font-mono">{{ order.order_no }}</dd>
      <dt class="text-base-content/60">{{ t('product') }}</dt><dd class="col-span-2">{{ order.product_name }} x{{ order.qty }}</dd>
      <dt class="text-base-content/60">{{ t('amount') }}</dt><dd class="col-span-2 font-semibold">{{ money(order.amount_cents) }} {{ order.fiat }}</dd>
      <dt class="text-base-content/60">{{ t('tradeType') }}</dt><dd class="col-span-2">{{ order.trade_type }}</dd>
      <dt class="text-base-content/60">{{ t('paymentGateway') }}</dt><dd class="col-span-2">{{ gatewayLabel(order) }}</dd>
      <dt class="text-base-content/60">{{ t('status') }}</dt><dd class="col-span-2">
        <span class="inline-flex items-center gap-1">
          {{ statusText(order.status) }}
          <span v-if="order.status === 'waiting_payment'" class="text-xs text-base-content/40">{{ t('autoRefresh') }}</span>
        </span>
      </dd>
      <dt class="text-base-content/60">{{ t('createdAt') }}</dt><dd class="col-span-2">{{ date(order.created_at) }}</dd>
      <template v-if="order.paid_at">
        <dt class="text-base-content/60">{{ t('paidAt') }}</dt><dd class="col-span-2">{{ date(order.paid_at) }}</dd>
      </template>
    </dl>
    <p v-if="order.status === 'pending_delivery'" class="mt-3 alert alert-info text-sm">
      {{ t('pendingDeliveryHint') }}
    </p>
    <div v-if="order.status === 'waiting_payment' && order.payment_url" class="mt-4 flex gap-2">
      <a :href="order.payment_url" class="btn btn-primary normal-case">{{ t('continuePay') }}</a>
      <button @click="cancel" class="btn btn-outline btn-error normal-case">
        {{ t('cancelOrder') }}
      </button>
    </div>
    <div v-if="order.delivery_type === 'manual' && order.delivery_content" class="mt-5">
      <h2 class="font-bold text-base-content mb-2">{{ t('deliveryInfo') }}</h2>
      <div class="bg-neutral text-success-content rounded-xl p-4 font-mono whitespace-pre-wrap">{{ order.delivery_content }}</div>
    </div>
    <div v-else-if="cards.length" class="mt-5">
      <h2 class="font-bold text-base-content mb-2">{{ t('cards') }}</h2>
      <ul class="bg-neutral text-success-content rounded-xl p-4 font-mono">
        <li v-for="c in cards" :key="c.id">{{ c.content }}</li>
      </ul>
      <p class="text-xs text-base-content/60 mt-2">{{ t('cardsSaved') }}</p>
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { date: siteDate } = useSiteConfig()
const api = useApi()
const { data } = await useAsyncData(() =>
  api.get('/orders/' + route.params.orderNo, {
    contact: route.query.contact || undefined,
    token: route.query.token || undefined,
  })
)
const order = computed(() => (data.value as any)?.order || {})
const cards = computed(() => (data.value as any)?.cards || [])

function money(c: number) { return ((c || 0) / 100).toFixed(2) }
function date(ts: number) { return siteDate(ts) }
function statusText(status: string) {
  return (t(`orderStatus.${status}`) as string) || status
}
function gatewayLabel(o: any) {
  const name = o?.payment_gateway_name?.trim()
  if (name) return name
  return o?.payment_gateway === 'hashpay' ? t('gatewayHashpay') : t('gatewayBepusdt')
}
useHead({ title: t('orderDetail'), meta: [{ name: 'robots', content: 'noindex,nofollow' }] })

let timer: any = null
async function cancel() {
  if (!confirm(t('cancelConfirm'))) return
  try {
    const token = String(route.query.token || '')
    const contact = String(route.query.contact || '')
    const query = token
      ? 'token=' + encodeURIComponent(token)
      : 'contact=' + encodeURIComponent(contact)
    await api.post('/orders/' + route.params.orderNo + '/cancel?' + query)
    await refresh()
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('cancelFail'))
  }
}
async function refresh() {
  try {
    const res: any = await api.get('/orders/' + route.params.orderNo, {
      contact: route.query.contact || undefined,
      token: route.query.token || undefined,
    })
    data.value = res
  } catch {
    // 忽略轮询错误，稍后重试
  }
  if (data.value?.order?.status === 'waiting_payment') {
    timer = setTimeout(refresh, 3000)
  }
}
onMounted(() => {
  if (order.value.status === 'waiting_payment') {
    timer = setTimeout(refresh, 3000)
  }
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>
