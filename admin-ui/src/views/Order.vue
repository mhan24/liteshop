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
      <el-button v-if="order.status === 'waiting_payment' || order.status === 'created'" @click="expire">{{ t('orders.markExpired') }}</el-button>
      <el-button v-if="['paid','processing','delivered','completed','delivery_failed'].includes(order.status) && cards.length" @click="resend">{{ t('orders.resend') }}</el-button>
      <el-button v-if="order.status === 'delivery_failed' || order.status === 'payment_failed'" type="warning" @click="redeliver">{{ t('orders.redeliver') }}</el-button>
    </div>
    <h3 style="margin-top:20px">{{ t('orders.logs') }}</h3>
    <el-timeline v-if="logs.length">
      <el-timeline-item
        v-for="log in logs"
        :key="log.id"
        :timestamp="date(log.created_at)"
        placement="top"
        :type="logType(log)"
      >
        <b>{{ eventText(log) }}</b>
        <div class="log-message">{{ log.message }}</div>
      </el-timeline-item>
    </el-timeline>
    <p v-else class="muted">{{ t('orders.noLogs') }}</p>
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
const logs = ref<any[]>([])

async function load() {
  loading.value = true
  try {
    const data = await api.get('/admin/orders/' + route.params.id)
    order.value = data.order || {}
    cards.value = data.cards || []
    logs.value = data.logs || []
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
  await load()
}
async function redeliver() {
  try {
    await api.post('/admin/orders/' + route.params.id + '/redeliver', {})
    ElMessage.success(t('orders.redeliverSent'))
    await load()
  } catch (e: any) {
    ElMessage.error(e.message)
  }
}
function statusText(status: string) {
  return (t(`orders.status.${status}`) as string) || status
}
function statusType(status: string): any {
  const m: any = {
    paid: 'success', processing: 'success', delivered: 'success', completed: 'success',
    waiting_payment: 'warning', created: 'info',
    expired: 'danger', payment_failed: 'danger', delivery_failed: 'danger', cancelled: 'info',
  }
  return m[status] || 'info'
}
function eventText(log: any) {
  return (t(`orders.events.${log.event}`) as string) || log.event
}
function logType(log: any): any {
  if (log.event === 'payment_success' || log.event === 'delivered') return 'success'
  if (log.event.includes('failed')) return 'danger'
  return 'primary'
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
.log-message {
  color: #666;
  font-size: 13px;
  margin-top: 2px;
}
.muted {
  color: #999;
  font-size: 13px;
}
</style>
