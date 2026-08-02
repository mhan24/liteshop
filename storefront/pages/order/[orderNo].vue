<template>
  <div class="max-w-xl bg-white rounded-xl border p-6 shadow-sm">
    <h1 class="text-xl font-bold mb-3">订单详情</h1>
    <dl class="grid grid-cols-3 gap-2 text-sm">
      <dt class="text-gray-500">订单号</dt><dd class="col-span-2 font-mono">{{ order.order_no }}</dd>
      <dt class="text-gray-500">商品</dt><dd class="col-span-2">{{ order.product_name }} x{{ order.qty }}</dd>
      <dt class="text-gray-500">金额</dt><dd class="col-span-2">{{ money(order.amount_cents) }} {{ order.fiat }}</dd>
      <dt class="text-gray-500">收款类型</dt><dd class="col-span-2">{{ order.trade_type }}</dd>
      <dt class="text-gray-500">状态</dt><dd class="col-span-2">
        <span class="inline-flex items-center gap-1">
          {{ statusText(order.status) }}
          <span v-if="order.status === 'pending'" class="text-xs text-gray-400">（自动刷新中）</span>
        </span>
      </dd>
      <dt class="text-gray-500">创建时间</dt><dd class="col-span-2">{{ date(order.created_at) }}</dd>
      <template v-if="order.paid_at">
        <dt class="text-gray-500">支付时间</dt><dd class="col-span-2">{{ date(order.paid_at) }}</dd>
      </template>
    </dl>
    <div v-if="order.status === 'pending' && order.payment_url" class="mt-4 flex gap-2">
      <a :href="order.payment_url" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold">继续支付</a>
      <button @click="cancel" class="border border-red-500 text-red-500 rounded-full px-4 py-2 font-semibold hover:bg-red-50">
        取消订单
      </button>
    </div>
    <div v-if="cards.length" class="mt-5">
      <h2 class="font-bold mb-2">卡密</h2>
      <ul class="bg-gray-900 text-green-200 rounded p-3 font-mono">
        <li v-for="c in cards" :key="c.id">{{ c.content }}</li>
      </ul>
      <p class="text-xs text-gray-500 mt-2">卡密已自动发放，请妥善保存。</p>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const api = useApi()
const { data } = await useAsyncData(() => api.get('/orders/' + route.params.orderNo, { contact: route.query.contact }))
const order = computed(() => (data.value as any)?.order || {})
const cards = computed(() => (data.value as any)?.cards || [])

function money(c: number) { return ((c || 0) / 100).toFixed(2) }
function date(ts: number) { if (!ts) return '-'; return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' }) }
function statusText(status: string) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '失败', cancelled: '已取消' }[status] || status
}
useHead({ title: '订单详情', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })

// 待支付时自动轮询，支付成功后停止
let timer: any = null
async function cancel() {
  if (!confirm('确定取消该订单吗？库存将被释放。')) return
  try {
    await api.post('/orders/' + route.params.orderNo + '/cancel')
    await refresh()
  } catch (e: any) {
    alert(e?.data?.error || e?.message || '取消失败')
  }
}
async function refresh() {
  try {
    const res: any = await api.get('/orders/' + route.params.orderNo, { contact: route.query.contact })
    data.value = res
  } catch {
    // 忽略轮询错误，稍后重试
  }
  if (data.value?.order?.status === 'pending') {
    timer = setTimeout(refresh, 3000)
  }
}
onMounted(() => {
  if (order.value.status === 'pending') {
    timer = setTimeout(refresh, 3000)
  }
})
onBeforeUnmount(() => {
  if (timer) clearTimeout(timer)
})
</script>
