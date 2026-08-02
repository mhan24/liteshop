<template>
  <el-card v-loading="loading">
    <template #header><h2>{{ t('orders.detail') }}</h2></template>
    <el-button @click="$router.push('/orders')">{{ t('orders.back') }}</el-button>
    <el-descriptions :column="1" border style="margin-top:12px">
      <el-descriptions-item :label="t('orders.orderNo')">{{ order.order_no }}</el-descriptions-item>
      <el-descriptions-item :label="t('orders.product')">{{ order.product_name }} x{{ order.qty }}</el-descriptions-item>
      <el-descriptions-item :label="t('orders.amount')">{{ money(order.amount_cents) }} {{ order.fiat }}</el-descriptions-item>
      <el-descriptions-item :label="t('orders.tradeId')">{{ order.trade_id }}</el-descriptions-item>
      <el-descriptions-item :label="t('common.status')">
        <el-tag :type="statusType(order.status)">{{ statusText(order.status) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item :label="t('orders.createdAt')">{{ date(order.created_at) }}</el-descriptions-item>
      <el-descriptions-item v-if="order.paid_at" :label="t('orders.paidAt')">{{ date(order.paid_at) }}</el-descriptions-item>
    </el-descriptions>
    <h3 style="margin-top:16px">{{ t('orders.cards') }}</h3>
    <ul class="card-list">
      <li v-for="c in cards" :key="c.id"><code>{{ c.content }}</code></li>
    </ul>
    <div style="margin-top:16px">
      <el-button v-if="order.status === 'pending'" @click="expire">{{ t('orders.markExpired') }}</el-button>
      <el-button v-if="order.status === 'paid'" @click="resend">{{ t('orders.resend') }}</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const route = useRoute()
const { t } = useI18n()
const loading = ref(false)
const order = ref<any>({})
const cards = ref<any[]>([])

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
  ElMessage.success(t('orders.resendSent'))
}
function statusText(status: string) {
  return (t(`orders.status.${status}`) as string) || status
}
function statusType(status: string): any {
  return { paid: 'success', pending: 'warning', expired: 'danger', failed: 'info', cancelled: 'info' }[status] || 'info'
}
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}
onMounted(load)
</script>

<style scoped>
.card-list {
  list-style: none;
  margin: 0;
  padding: 12px;
  background: #1f2329;
  border-radius: 8px;
  color: #d8f7ee;
  font-family: ui-monospace, monospace;
}
.card-list li {
  padding: 2px 0;
}
</style>
