<template>
  <div class="max-w-xl bg-white rounded-xl border p-6 shadow-sm">
    <h1 class="text-xl font-bold mb-3">{{ t('orderDetail') }}</h1>
    <dl class="grid grid-cols-3 gap-2 text-sm">
      <dt class="text-gray-500">{{ t('orderNo') }}</dt><dd class="col-span-2 font-mono">{{ order.order_no }}</dd>
      <dt class="text-gray-500">{{ t('product') }}</dt><dd class="col-span-2">{{ order.product_name }} x{{ order.qty }}</dd>
      <dt class="text-gray-500">{{ t('amount') }}</dt><dd class="col-span-2">{{ money(order.amount_cents) }} {{ order.fiat }}</dd>
      <dt class="text-gray-500">{{ t('tradeType') }}</dt><dd class="col-span-2">{{ order.trade_type }}</dd>
      <dt class="text-gray-500">{{ t('status') }}</dt><dd class="col-span-2">
        <span class="inline-flex items-center gap-1">
          {{ statusText(order.status) }}
          <span v-if="order.status === 'waiting_payment'" class="text-xs text-gray-400">{{ t('autoRefresh') }}</span>
        </span>
      </dd>
      <dt class="text-gray-500">{{ t('createdAt') }}</dt><dd class="col-span-2">{{ date(order.created_at) }}</dd>
      <template v-if="order.paid_at">
        <dt class="text-gray-500">{{ t('paidAt') }}</dt><dd class="col-span-2">{{ date(order.paid_at) }}</dd>
      </template>
    </dl>
    <div v-if="order.status === 'waiting_payment' && order.payment_url" class="mt-4 flex gap-2">
      <a :href="order.payment_url" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold">{{ t('continuePay') }}</a>
      <button @click="cancel" class="border border-red-500 text-red-500 rounded-full px-4 py-2 font-semibold hover:bg-red-50">
        {{ t('cancelOrder') }}
      </button>
    </div>
    <div v-if="cards.length" class="mt-5">
      <h2 class="font-bold mb-2">{{ t('cards') }}</h2>
      <ul class="bg-gray-900 text-green-200 rounded p-3 font-mono">
        <li v-for="c in cards" :key="c.id">{{ c.content }}</li>
      </ul>
      <p class="text-xs text-gray-500 mt-2">{{ t('cardsSaved') }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const { date: siteDate } = useSiteConfig()
const api = useApi()
const { data } = await useAsyncData(() => api.get('/orders/' + route.params.orderNo, { contact: route.query.contact }))
const order = computed(() => (data.value as any)?.order || {})
const cards = computed(() => (data.value as any)?.cards || [])

function money(c: number) { return ((c || 0) / 100).toFixed(2) }
function date(ts: number) { return siteDate(ts) }
function statusText(status: string) {
  return (t(`orderStatus.${status}`) as string) || status
}
useHead({ title: t('orderDetail'), meta: [{ name: 'robots', content: 'noindex,nofollow' }] })

let timer: any = null
async function cancel() {
  if (!confirm(t('cancelConfirm'))) return
  try {
    const contact = encodeURIComponent(String(route.query.contact || ''))
    await api.post('/orders/' + route.params.orderNo + '/cancel?contact=' + contact)
    await refresh()
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('cancelFail'))
  }
}
async function refresh() {
  try {
    const res: any = await api.get('/orders/' + route.params.orderNo, { contact: route.query.contact })
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
