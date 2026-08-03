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

    <div v-if="orders.length" class="mt-5 divide-y">
      <div v-for="item in orders" :key="item.order_no || item.created_at" class="py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-semibold">{{ item.product_name }} x{{ item.qty }}</div>
          <div class="text-sm text-gray-500">
            <span v-if="item.order_no">{{ t('orderNo') }}：{{ item.order_no }} · {{ date(item.created_at) }}</span>
            <span v-else>{{ t('paidOrderSent') }} · {{ date(item.paid_at || item.created_at) }}</span>
          </div>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="badgeClass(item.status)">{{ statusText(item.status) }}</span>
        </div>
        <div class="flex gap-2">
          <NuxtLink v-if="item.url" :to="item.url.replace(/^https?:\/\/[^/]+/, '')" class="text-brand font-semibold">{{ t('viewOrder') }}</NuxtLink>
          <a v-if="item.payment_url" :href="item.payment_url" class="text-brand font-semibold">{{ t('continuePay') }}</a>
        </div>
      </div>
    </div>
    <div v-else-if="searched && !loading" class="text-gray-500 mt-5">{{ t('noOrders') }}</div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const api = useApi()
const form = reactive({ contact: '', order_no: '' })
const orders = ref<any[]>([])
const loading = ref(false)
const searched = ref(false)

async function submit() {
  if (form.order_no) {
    await navigateTo({ path: `/order/${form.order_no}`, query: { contact: form.contact } })
    return
  }
  loading.value = true
  searched.value = true
  orders.value = []
  try {
    const data: any = await api.get('/orders', { contact: form.contact })
    orders.value = data.orders || []
  } catch (e: any) {
    alert(e?.data?.error || e?.message || t('queryFail'))
  } finally {
    loading.value = false
  }
}
function date(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
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
