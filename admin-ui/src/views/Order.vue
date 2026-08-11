<template>
  <div>
    <div v-if="loading" class="flex justify-center py-24">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold">{{ t('orders.detail') }} · {{ order.order_no }}</h2>
          <span class="badge" :class="statusBadgeClass(order.status)">{{ statusText(order.status) }}</span>
        </div>
        <button class="btn btn-ghost btn-sm" @click="$router.push('/orders')">{{ t('orders.back') }}</button>
      </div>

      <!-- 操作按钮 -->
      <div v-if="store.canWrite" class="card mt-4 bg-base-100 shadow-sm ring-1 ring-base-300">
        <div class="card-body flex flex-wrap gap-2 !py-4">
          <button
            v-if="['paid', 'processing', 'delivered', 'completed', 'delivery_failed'].includes(order.status) && cards.length"
            class="btn btn-primary btn-sm"
            @click="resend"
          >
            {{ t('orders.resend') }}
          </button>
          <button
            v-if="order.status === 'delivery_failed' || order.status === 'payment_failed'"
            class="btn btn-warning btn-sm"
            @click="redeliver"
          >
            {{ t('orders.redeliver') }}
          </button>
          <button
            v-if="order.delivery_type === 'manual' && order.status === 'pending_delivery'"
            class="btn btn-primary btn-sm"
            @click="deliverDialog = true"
          >
            {{ t('orders.manualDeliver') }}
          </button>
          <button
            v-if="order.status === 'waiting_payment' || order.status === 'created'"
            class="btn btn-error btn-outline btn-sm"
            @click="cancelOrder"
          >
            {{ t('orders.cancel') }}
          </button>
          <button class="btn btn-ghost btn-sm" @click="statusDialog = true">{{ t('orders.changeStatus') }}</button>
        </div>
      </div>

      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <!-- 订单信息 -->
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !pb-2">
            <h3 class="font-semibold">{{ t('orders.orderInfo') }}</h3>
          </div>
          <div class="card-body !pt-2">
            <dl class="divide-y divide-base-200 text-sm">
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.orderNo') }}</dt>
                <dd class="font-mono font-medium">{{ order.order_no }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.product') }}</dt>
                <dd class="font-medium">{{ order.product_name }} x{{ order.qty }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.amount') }}</dt>
                <dd class="font-medium">{{ money(order.amount_cents) }} {{ order.fiat }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.contact') }}</dt>
                <dd class="font-medium break-all text-right">{{ order.buyer_contact }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.createdAt') }}</dt>
                <dd class="font-medium">{{ date(order.created_at) }}</dd>
              </div>
              <div v-if="order.paid_at" class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.paidAt') }}</dt>
                <dd class="font-medium">{{ date(order.paid_at) }}</dd>
              </div>
            </dl>
          </div>
        </div>

        <!-- 支付信息 -->
        <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
          <div class="card-body !pb-2">
            <h3 class="font-semibold">{{ t('orders.paymentInfo') }}</h3>
          </div>
          <div class="card-body !pt-2">
            <dl class="divide-y divide-base-200 text-sm">
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.tradeId') }}</dt>
                <dd class="mono font-medium text-right">{{ order.trade_id || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.blockTx') }}</dt>
                <dd class="mono font-medium text-right">{{ order.block_transaction_id || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.tradeType') }}</dt>
                <dd class="font-medium">{{ order.trade_type || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 opacity-60">{{ t('orders.checkout') }}</dt>
                <dd class="mono max-w-[60%] text-right text-primary">
                  <a v-if="order.payment_url" :href="order.payment_url" target="_blank" rel="noopener">
                    {{ order.payment_url }}
                  </a>
                  <span v-else class="opacity-60">-</span>
                </dd>
              </div>
            </dl>
          </div>
        </div>
      </div>

      <!-- 卡密信息 -->
      <div class="card mt-4 bg-base-100 shadow-sm ring-1 ring-base-300">
        <div class="card-body !pb-2">
          <h3 class="font-semibold">
            {{ order.delivery_type === 'manual' ? t('orders.deliveryInfo') : t('orders.cards') }} ({{
              order.delivery_type === 'manual' && order.delivery_content ? 1 : cards.length
            }})
          </h3>
        </div>
        <div class="card-body !pt-2">
          <div v-if="order.delivery_type === 'manual' && order.delivery_content" class="rounded-xl bg-base-200 p-4">
            {{ order.delivery_content }}
          </div>
          <div v-else-if="cards.length" class="card-code-block">
            <div v-for="c in cards" :key="c.id" class="py-0.5">{{ c.content }}</div>
          </div>
          <p v-else class="text-sm opacity-60">{{ t('orders.noCards') }}</p>
        </div>
      </div>

      <!-- 日志 -->
      <div class="card mt-4 bg-base-100 shadow-sm ring-1 ring-base-300">
        <div class="card-body !pb-2">
          <h3 class="font-semibold">{{ t('orders.logs') }}</h3>
        </div>
        <div class="card-body !pt-2">
          <ul v-if="logs.length" class="timeline timeline-vertical">
            <li v-for="(log, i) in logs" :key="log.id">
              <template v-if="i !== 0">
                <hr class="bg-base-300" />
              </template>
              <div class="timeline-middle">
                <span class="badge badge-sm badge-ghost" :class="logBadgeClass(log)"></span>
              </div>
              <div class="timeline-end pb-6">
                <div class="text-xs opacity-60">{{ date(log.created_at) }}</div>
                <div class="mt-0.5 font-medium">{{ eventText(log) }}</div>
                <div v-if="log.message" class="mt-0.5 text-sm opacity-70">{{ log.message }}</div>
              </div>
            </li>
          </ul>
          <p v-else class="text-sm opacity-60">{{ t('orders.noLogs') }}</p>
        </div>
      </div>

      <!-- 修改状态对话框 -->
      <Modal :open="statusDialog" :title="t('orders.changeStatus')" @close="statusDialog = false">
        <div class="space-y-4">
          <FormField :label="t('common.status')">
            <select v-model="newStatus" class="select select-bordered w-full">
              <option v-for="(label, key) in statusOptions" :key="key" :value="key">{{ label }}</option>
            </select>
          </FormField>
          <FormField :label="t('orders.statusMessage')">
            <textarea v-model="statusMessage" class="textarea textarea-bordered w-full" rows="2"></textarea>
          </FormField>
        </div>
        <template #footer>
          <button class="btn btn-ghost" @click="statusDialog = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :class="{ 'btn-disabled': savingStatus }" @click="changeStatus">
            <span v-if="savingStatus" class="loading loading-spinner loading-xs"></span>
            {{ t('common.confirm') }}
          </button>
        </template>
      </Modal>

      <!-- 人工发货对话框 -->
      <Modal :open="deliverDialog" :title="t('orders.manualDeliver')" @close="deliverDialog = false">
        <FormField :label="t('orders.manualDeliverContent')">
          <textarea
            v-model="deliverContent"
            class="textarea textarea-bordered w-full"
            rows="6"
            :placeholder="t('orders.manualDeliverContentPlaceholder')"
          ></textarea>
        </FormField>
        <template #footer>
          <button class="btn btn-ghost" @click="deliverDialog = false">{{ t('common.cancel') }}</button>
          <button class="btn btn-primary" :class="{ 'btn-disabled': delivering }" @click="manualDeliver">
            <span v-if="delivering" class="loading loading-spinner loading-xs"></span>
            {{ t('common.confirm') }}
          </button>
        </template>
      </Modal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'
import { statusBadgeClass } from '@/utils/status'
import { useSessionStore } from '@/stores/session'
import Modal from '@/components/ui/Modal.vue'
import FormField from '@/components/ui/FormField.vue'
import { confirm } from '@/components/ui/confirm'
import { toastError, toastSuccess, toastWarning } from '@/components/ui/toast'

const route = useRoute()
const { t } = useI18n()
const store = useSessionStore()
const loading = ref(true)
const savingStatus = ref(false)
const order = ref<any>({})
const cards = ref<any[]>([])
const logs = ref<any[]>([])
const statusDialog = ref(false)
const newStatus = ref('')
const statusMessage = ref('')
const deliverDialog = ref(false)
const deliverContent = ref('')
const delivering = ref(false)

const statusOptions = computed(() => ({
  created: t('orders.status.created'),
  waiting_payment: t('orders.status.waiting_payment'),
  paid: t('orders.status.paid'),
  processing: t('orders.status.processing'),
  pending_delivery: t('orders.status.pending_delivery'),
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
async function resend() {
  await api.post('/admin/orders/' + route.params.id + '/resend', {})
  toastSuccess(t('orders.resendSent'))
  await load()
}
async function redeliver() {
  try {
    await api.post('/admin/orders/' + route.params.id + '/redeliver', {})
    toastSuccess(t('orders.redeliverSent'))
    await load()
  } catch (e: any) {
    toastError(e.message)
  }
}
async function manualDeliver() {
  if (!deliverContent.value.trim()) {
    toastWarning(t('orders.manualDeliverRequired'))
    return
  }
  delivering.value = true
  try {
    await api.post('/admin/orders/' + route.params.id + '/deliver', { content: deliverContent.value })
    toastSuccess(t('orders.manualDeliverSent'))
    deliverDialog.value = false
    deliverContent.value = ''
    await load()
  } catch (e: any) {
    toastError(e.message)
  } finally {
    delivering.value = false
  }
}
async function cancelOrder() {
  const ok = await confirm({ title: t('common.prompt'), message: t('orders.cancelConfirm'), danger: true })
  if (!ok) return
  try {
    await api.post('/admin/orders/' + route.params.id + '/cancel', {})
    toastSuccess(t('orders.cancelledMsg'))
    await load()
  } catch (e: any) {
    toastError(e.message || '')
  }
}
async function changeStatus() {
  if (!newStatus.value) {
    toastWarning(t('orders.statusRequired'))
    return
  }
  savingStatus.value = true
  try {
    await api.post('/admin/orders/' + route.params.id + '/status', {
      status: newStatus.value,
      message: statusMessage.value,
    })
    toastSuccess(t('orders.statusChanged'))
    statusDialog.value = false
    newStatus.value = ''
    statusMessage.value = ''
    await load()
  } catch (e: any) {
    toastError(e.message)
  } finally {
    savingStatus.value = false
  }
}
function statusText(status: string) {
  return (t(`orders.status.${status}`) as string) || status
}
function eventText(log: any) {
  return (t(`orders.events.${log.event}`) as string) || log.event
}
function logBadgeClass(log: any) {
  if (log.event === 'payment_success' || log.event === 'delivered') return 'badge-success'
  if (log.event.includes('failed')) return 'badge-error'
  return 'badge-primary'
}
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  return fmtDate(ts)
}
onMounted(load)
</script>
