<template>
  <div v-loading="loading">
    <div class="page-head">
      <h2>{{ t('orders.detail') }} · {{ order.order_no }}</h2>
      <div>
        <el-tag :type="statusType(order.status)" size="large">{{ statusText(order.status) }}</el-tag>
        <el-button style="margin-left:8px" @click="$router.push('/orders')">{{ t('orders.back') }}</el-button>
      </div>
    </div>

    <!-- 操作按钮 -->
    <el-card style="margin-top:12px">
      <template #header><span>{{ t('orders.actions') }}</span></template>
      <el-space v-if="store.canWrite" wrap>
        <el-button
          v-if="['paid','processing','delivered','completed','delivery_failed'].includes(order.status) && cards.length"
          type="primary"
          @click="resend"
        >{{ t('orders.resend') }}</el-button>
        <el-button
          v-if="order.status === 'delivery_failed' || order.status === 'payment_failed'"
          type="warning"
          @click="redeliver"
        >{{ t('orders.redeliver') }}</el-button>
        <el-button
          v-if="order.status === 'waiting_payment' || order.status === 'created'"
          type="danger"
          plain
          @click="cancelOrder"
        >{{ t('orders.cancel') }}</el-button>
        <el-button @click="statusDialog = true">{{ t('orders.changeStatus') }}</el-button>
      </el-space>
    </el-card>

    <el-row :gutter="16" style="margin-top:16px">
      <!-- 订单信息 -->
      <el-col :md="12">
        <el-card>
          <template #header><span>{{ t('orders.orderInfo') }}</span></template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item :label="t('orders.orderNo')">{{ order.order_no }}</el-descriptions-item>
            <el-descriptions-item :label="t('orders.product')">{{ order.product_name }} x{{ order.qty }}</el-descriptions-item>
            <el-descriptions-item :label="t('orders.amount')">{{ money(order.amount_cents) }} {{ order.fiat }}</el-descriptions-item>
            <el-descriptions-item :label="t('orders.contact')">{{ order.buyer_contact }}</el-descriptions-item>
            <el-descriptions-item :label="t('orders.createdAt')">{{ date(order.created_at) }}</el-descriptions-item>
            <el-descriptions-item v-if="order.paid_at" :label="t('orders.paidAt')">{{ date(order.paid_at) }}</el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>

      <!-- 支付信息 -->
      <el-col :md="12">
        <el-card>
          <template #header><span>{{ t('orders.paymentInfo') }}</span></template>
          <el-descriptions :column="1" size="small" border>
            <el-descriptions-item :label="t('orders.tradeId')">
              <code class="mono">{{ order.trade_id || '-' }}</code>
            </el-descriptions-item>
            <el-descriptions-item :label="t('orders.blockTx')">
              <code class="mono">{{ order.block_transaction_id || '-' }}</code>
            </el-descriptions-item>
            <el-descriptions-item :label="t('orders.tradeType')">{{ order.trade_type || '-' }}</el-descriptions-item>
            <el-descriptions-item :label="t('orders.checkout')">
              <a v-if="order.payment_url" :href="order.payment_url" target="_blank" rel="noopener" class="link">{{ order.payment_url }}</a>
              <span v-else>-</span>
            </el-descriptions-item>
          </el-descriptions>
        </el-card>
      </el-col>
    </el-row>

    <!-- 卡密信息 -->
    <el-card style="margin-top:16px">
      <template #header><span>{{ t('orders.cards') }} ({{ cards.length }})</span></template>
      <ul class="card-list">
        <li v-for="c in cards" :key="c.id"><code>{{ c.content }}</code></li>
      </ul>
      <div v-if="!cards.length" class="empty-tip">{{ t('orders.noCards') }}</div>
    </el-card>

    <!-- 日志 / 通知记录 -->
    <el-card style="margin-top:16px">
      <template #header><span>{{ t('orders.logs') }}</span></template>
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

    <!-- 修改状态对话框 -->
    <el-dialog v-model="statusDialog" :title="t('orders.changeStatus')" width="420px">
      <el-form label-position="top">
        <el-form-item :label="t('common.status')">
          <el-select v-model="newStatus" style="width:100%">
            <el-option v-for="(label, key) in statusOptions" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item :label="t('orders.statusMessage')">
          <el-input v-model="statusMessage" type="textarea" :rows="2" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="statusDialog = false">{{ t('common.cancel') }}</el-button>
        <el-button type="primary" :loading="savingStatus" @click="changeStatus">{{ t('common.confirm') }}</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { ElMessage, ElMessageBox } from 'element-plus'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'
import { useSessionStore } from '@/stores/session'

const route = useRoute()
const { t } = useI18n()
const store = useSessionStore()
const loading = ref(false)
const savingStatus = ref(false)
const order = ref<any>({})
const cards = ref<any[]>([])
const logs = ref<any[]>([])
const statusDialog = ref(false)
const newStatus = ref('')
const statusMessage = ref('')

const statusOptions = computed(() => ({
  created: t('orders.status.created'),
  waiting_payment: t('orders.status.waiting_payment'),
  paid: t('orders.status.paid'),
  processing: t('orders.status.processing'),
  delivered: t('orders.status.delivered'),
  completed: t('orders.status.completed'),
  payment_failed: t('orders.status.payment_failed'),
  delivery_failed: t('orders.status.delivery_failed'),
  cancelled: t('orders.status.cancelled'),
  expired: t('orders.status.expired'),
}))

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
async function cancelOrder() {
  try {
    await ElMessageBox.confirm(t('orders.cancelConfirm'), t('common.prompt'), { type: 'warning' })
    await api.post('/admin/orders/' + route.params.id + '/cancel', {})
    ElMessage.success(t('orders.cancelledMsg'))
    await load()
  } catch (e: any) {
    if (e !== 'cancel') ElMessage.error(e.message || '')
  }
}
async function changeStatus() {
  if (!newStatus.value) {
    ElMessage.warning(t('orders.statusRequired'))
    return
  }
  savingStatus.value = true
  try {
    await api.post('/admin/orders/' + route.params.id + '/status', {
      status: newStatus.value,
      message: statusMessage.value,
    })
    ElMessage.success(t('orders.statusChanged'))
    statusDialog.value = false
    newStatus.value = ''
    statusMessage.value = ''
    await load()
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    savingStatus.value = false
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
  if (log.event === 'notify_sent') return 'primary'
  if (log.event.includes('failed')) return 'danger'
  return 'primary'
}
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  return fmtDate(ts)
}
onMounted(load)
</script>

<style scoped>
.page-head {
  display: flex;
  justify-content: space-between;
  align-items: center;
}
.page-head h2 {
  margin: 0;
}
.mono {
  font-family: ui-monospace, monospace;
  word-break: break-all;
}
.link {
  color: #409eff;
  word-break: break-all;
}
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
.empty-tip {
  color: #c0c4cc;
  font-size: 13px;
  text-align: center;
  padding: 12px 0;
}
</style>
