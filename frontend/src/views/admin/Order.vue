<template>
  <a-spin :spinning="loading">
    <a-button @click="$router.push('/admin/orders')">返回订单</a-button>
    <a-descriptions title="订单详情" :column="1" size="small" bordered style="margin-top:16px">
      <a-descriptions-item label="订单号">{{ order.order_no }}</a-descriptions-item>
      <a-descriptions-item label="商品">{{ order.product_name }} x{{ order.qty }}</a-descriptions-item>
      <a-descriptions-item label="状态">
        <a-tag :color="statusColor(order.status)">{{ statusText(order.status) }}</a-tag>
      </a-descriptions-item>
      <a-descriptions-item label="交易 ID">{{ order.trade_id }}</a-descriptions-item>
    </a-descriptions>
    <a-divider orientation="left">卡密</a-divider>
    <a-list bordered :data-source="cards">
      <template #renderItem="{ item }"><a-list-item><code>{{ item.content }}</code></a-list-item></template>
    </a-list>
    <a-space style="margin-top:16px">
      <a-popconfirm v-if="order.status === 'pending'" title="标记过期？" @confirm="expire">
        <a-button>标记过期并释放库存</a-button>
      </a-popconfirm>
      <a-popconfirm v-if="order.status === 'paid'" title="重发通知？" @confirm="resend">
        <a-button>重发通知</a-button>
      </a-popconfirm>
    </a-space>
  </a-spin>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { message } from 'ant-design-vue'
import { api } from '@/api'
const route = useRoute()
const loading = ref(false)
const order = ref({})
const cards = ref([])
async function load() {
  loading.value = true
  try {
    const data = await api.get('/admin/orders/' + route.params.id)
    order.value = data.order || {}
    cards.value = data.cards || []
  } finally {
    loading.value = false
  }
}
async function expire() {
  await api.post('/admin/orders/' + route.params.id + '/expire', {})
  await load()
}
async function resend() {
  await api.post('/admin/orders/' + route.params.id + '/resend', {})
  message.success('已发送')
}
onMounted(load)
function statusColor(status) {
  return { paid: 'success', pending: 'warning', expired: 'error', failed: 'default' }[status] || 'default'
}
function statusText(status) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '创建失败' }[status] || status
}
</script>
