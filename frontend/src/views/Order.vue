<template>
  <a-card title="订单详情">
    <a-spin :spinning="loading">
      <a-descriptions :column="1" bordered size="small">
        <a-descriptions-item label="订单号">{{ order.order_no }}</a-descriptions-item>
        <a-descriptions-item label="商品">{{ order.product_name }} x{{ order.qty }}</a-descriptions-item>
        <a-descriptions-item label="金额">{{ money(order.amount_cents) }} {{ order.fiat }}</a-descriptions-item>
        <a-descriptions-item label="收款类型">{{ order.trade_type }}</a-descriptions-item>
        <a-descriptions-item label="状态">
          <a-tag :color="statusColor(order.status)">{{ statusText(order.status) }}</a-tag>
        </a-descriptions-item>
        <a-descriptions-item label="创建时间">{{ date(order.created_at) }}</a-descriptions-item>
        <a-descriptions-item v-if="order.paid_at" label="支付时间">{{ date(order.paid_at) }}</a-descriptions-item>
      </a-descriptions>
      <template v-if="order.status === 'paid' && cards.length">
        <a-divider orientation="left">卡密</a-divider>
        <a-list bordered :data-source="cards">
          <template #renderItem="{ item }">
            <a-list-item><code>{{ item.content }}</code></a-list-item>
          </template>
        </a-list>
      </template>
      <div v-if="order.status === 'pending' && order.payment_url" style="margin-top:16px">
        <a-button type="primary" :href="order.payment_url">继续支付</a-button>
      </div>
    </a-spin>
  </a-card>
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

function money(cents) {
  return (cents / 100).toFixed(2)
}
function date(ts) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}
function statusColor(status) {
  return { paid: 'success', pending: 'warning', expired: 'error', failed: 'default' }[status] || 'default'
}
function statusText(status) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '创建失败' }[status] || status
}

async function load() {
  loading.value = true
  try {
    const data = await api.get('/orders/' + route.params.orderNo, { contact: route.query.contact })
    order.value = data.order || {}
    cards.value = data.cards || []
  } catch (e) {
    message.error(e.message)
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
