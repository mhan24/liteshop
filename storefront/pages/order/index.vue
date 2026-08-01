<template>
  <div class="max-w-xl bg-white rounded-xl border p-6 shadow-sm">
    <h1 class="text-xl font-bold">订单查询</h1>
    <p class="text-gray-500 text-sm mt-1">忘记订单号？只填下单邮箱即可找回最近订单和付款链接。</p>
    <form class="mt-4 grid gap-3" @submit.prevent="submit">
      <div>
        <label class="text-sm font-semibold">下单邮箱</label>
        <input type="email" v-model="form.contact" required class="w-full border rounded px-3 py-2" />
      </div>
      <div>
        <label class="text-sm font-semibold">订单号（可选）</label>
        <input v-model="form.order_no" placeholder="留空则按邮箱找回最近订单" class="w-full border rounded px-3 py-2" />
      </div>
      <button type="submit" :disabled="loading" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold disabled:opacity-60">
        {{ form.order_no ? '查询该订单' : '用邮箱找回订单' }}
      </button>
    </form>

    <div v-if="orders.length" class="mt-5 divide-y">
      <div v-for="item in orders" :key="item.order_no || item.created_at" class="py-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <div class="font-semibold">{{ item.product_name }} x{{ item.qty }}</div>
          <div class="text-sm text-gray-500">
            <span v-if="item.order_no">订单号：{{ item.order_no }} · {{ date(item.created_at) }}</span>
            <span v-else>已支付订单 · 卡密已发送到邮箱 · {{ date(item.paid_at || item.created_at) }}</span>
          </div>
          <span class="text-xs px-2 py-0.5 rounded-full" :class="badgeClass(item.status)">{{ statusText(item.status) }}</span>
        </div>
        <div class="flex gap-2">
          <NuxtLink v-if="item.url" :to="item.url.replace(/^https?:\/\/[^/]+/, '')" class="text-brand font-semibold">查看订单</NuxtLink>
          <a v-if="item.payment_url" :href="item.payment_url" class="text-brand font-semibold">继续支付</a>
        </div>
      </div>
    </div>
    <div v-else-if="searched && !loading" class="text-gray-500 mt-5">没有找到相关订单。</div>
  </div>
</template>

<script setup lang="ts">
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
    alert(e?.data?.error || e?.message || '查询失败')
  } finally {
    loading.value = false
  }
}
function date(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}
function statusText(status: string) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '失败' }[status] || status
}
function badgeClass(status: string) {
  return {
    paid: 'bg-green-100 text-green-700',
    pending: 'bg-yellow-100 text-yellow-700',
    expired: 'bg-red-100 text-red-700',
    failed: 'bg-gray-100 text-gray-600',
  }[status] || 'bg-gray-100 text-gray-600'
}
useHead({ title: '订单查询', meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
