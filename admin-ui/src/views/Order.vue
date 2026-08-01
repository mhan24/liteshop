<template>
  <el-card v-loading="loading">
    <template #header><h2>订单详情</h2></template>
    <el-descriptions :column="1" border>
      <el-descriptions-item label="订单号">{{ order.order_no }}</el-descriptions-item>
      <el-descriptions-item label="商品">{{ order.product_name }} x{{ order.qty }}</el-descriptions-item>
      <el-descriptions-item label="金额">{{ money(order.amount_cents) }} {{ order.fiat }}</el-descriptions-item>
      <el-descriptions-item label="收款类型">{{ order.trade_type }}</el-descriptions-item>
      <el-descriptions-item label="状态">
        <el-tag :type="statusType(order.status)">{{ statusText(order.status) }}</el-tag>
      </el-descriptions-item>
      <el-descriptions-item label="交易 ID">{{ order.trade_id }}</el-descriptions-item>
      <el-descriptions-item label="创建时间">{{ date(order.created_at) }}</el-descriptions-item>
      <el-descriptions-item v-if="order.paid_at" label="支付时间">{{ date(order.paid_at) }}</el-descriptions-item>
    </el-descriptions>
    <h3 style="margin-top:16px">卡密</h3>
    <ul class="card-list">
      <li v-for="c in cards" :key="c.id"><code>{{ c.content }}</code></li>
    </ul>
    <div style="margin-top:16px">
      <el-button v-if="order.status === 'pending'" @click="expire">标记过期并释放库存</el-button>
      <el-button v-if="order.status === 'paid'" @click="resend">重发通知</el-button>
    </div>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const route = useRoute()
const router = useRouter()
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
  ElMessage.success('已发送')
}
function date(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function statusText(status: string) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '创建失败' }[status] || status
}
function statusType(status: string): any {
  return { paid: 'success', pending: 'warning', expired: 'danger', failed: 'info' }[status] || 'info'
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
