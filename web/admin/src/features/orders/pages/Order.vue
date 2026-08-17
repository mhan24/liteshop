<template>
  <div>
    <div v-if="loading" class="flex justify-center py-24">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
    </div>

    <template v-else>
      <div class="flex flex-wrap items-center justify-between gap-3">
        <div class="flex items-center gap-3">
          <h2 class="text-xl font-bold">{{ t('orders.detail') }} · {{ order.order_no }}</h2>
          <Badge :class="statusBadgeClass(order.status)">{{ statusText(order.status) }}</Badge>
        </div>
        <Button variant="ghost" size="sm" @click="$router.push('/orders')">{{ t('orders.back') }}</Button>
      </div>

      <Card v-if="store.canWrite" class="mt-4">
        <CardContent class="flex flex-wrap gap-2">
          <Button
            v-if="
              ['paid', 'processing', 'delivered', 'completed', 'delivery_failed'].includes(order.status) &&
              (cards.length || (order.delivery_type === 'manual' && order.delivery_content))
            "
            size="sm"
            @click="resend"
          >
            {{ t('orders.resend') }}
          </Button>
          <Button
            v-if="order.status === 'delivery_failed' || order.status === 'payment_failed'"
            variant="secondary"
            size="sm"
            @click="redeliver"
          >
            {{ t('orders.redeliver') }}
          </Button>
          <Button
            v-if="order.delivery_type === 'manual' && order.status === 'pending_delivery'"
            size="sm"
            @click="deliverDialog = true"
          >
            {{ t('orders.manualDeliver') }}
          </Button>
          <Button
            v-if="order.status === 'waiting_payment' || order.status === 'created'"
            variant="destructive"
            size="sm"
            @click="cancelOrder"
          >
            {{ t('orders.cancel') }}
          </Button>
          <Button variant="outline" size="sm" @click="statusDialog = true">{{ t('orders.changeStatus') }}</Button>
        </CardContent>
      </Card>

      <div class="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('orders.orderInfo') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="divide-y text-sm">
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.orderNo') }}</dt>
                <dd class="font-mono font-medium">{{ order.order_no }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.product') }}</dt>
                <dd class="font-medium">{{ order.product_name }} x{{ order.qty }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.amount') }}</dt>
                <dd class="font-medium">{{ money(order.amount_cents) }} {{ order.fiat }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.contact') }}</dt>
                <dd class="break-all text-right font-medium">{{ order.buyer_contact }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.createdAt') }}</dt>
                <dd class="font-medium">{{ date(order.created_at) }}</dd>
              </div>
              <div v-if="order.paid_at" class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.paidAt') }}</dt>
                <dd class="font-medium">{{ date(order.paid_at) }}</dd>
              </div>
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle class="text-base">{{ t('orders.paymentInfo') }}</CardTitle>
          </CardHeader>
          <CardContent>
            <dl class="divide-y text-sm">
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.tradeId') }}</dt>
                <dd class="mono text-right font-medium">{{ order.trade_id || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.blockTx') }}</dt>
                <dd class="mono text-right font-medium">{{ order.block_transaction_id || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.tradeType') }}</dt>
                <dd class="font-medium">{{ order.trade_type || '-' }}</dd>
              </div>
              <div class="flex items-center justify-between gap-4 py-2.5">
                <dt class="shrink-0 text-muted-foreground">{{ t('orders.checkout') }}</dt>
                <dd class="mono max-w-[60%] text-right text-primary">
                  <a v-if="order.payment_url" :href="order.payment_url" target="_blank" rel="noopener">
                    {{ order.payment_url }}
                  </a>
                  <span v-else class="text-muted-foreground">-</span>
                </dd>
              </div>
            </dl>
          </CardContent>
        </Card>
      </div>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle class="text-base">
            {{ order.delivery_type === 'manual' ? t('orders.deliveryInfo') : t('orders.cards') }} ({{
              order.delivery_type === 'manual' && order.delivery_content ? 1 : cards.length
            }})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div v-if="order.delivery_type === 'manual' && order.delivery_content" class="rounded-lg bg-muted p-4">
            {{ order.delivery_content }}
          </div>
          <div v-else-if="cards.length" class="card-code-block">
            <div v-for="c in cards" :key="c.id" class="py-0.5">{{ c.content }}</div>
          </div>
          <p v-else class="text-sm text-muted-foreground">{{ t('orders.noCards') }}</p>
        </CardContent>
      </Card>

      <Card class="mt-4">
        <CardHeader>
          <CardTitle class="text-base">{{ t('orders.logs') }}</CardTitle>
        </CardHeader>
        <CardContent>
          <ol v-if="logs.length" class="relative space-y-6 border-l pl-6">
            <li v-for="log in logs" :key="log.id" class="relative">
              <span
                class="absolute -left-[27px] top-1.5 h-3 w-3 rounded-full border-2 border-background"
                :class="logDotClass(log)"
              ></span>
              <div class="text-xs text-muted-foreground">{{ date(log.created_at) }}</div>
              <div class="mt-0.5 font-medium">{{ eventText(log) }}</div>
              <div v-if="log.message" class="mt-0.5 text-sm text-muted-foreground">{{ log.message }}</div>
            </li>
          </ol>
          <p v-else class="text-sm text-muted-foreground">{{ t('orders.noLogs') }}</p>
        </CardContent>
      </Card>

      <Modal :open="statusDialog" :title="t('orders.changeStatus')" @close="statusDialog = false">
        <div class="space-y-4">
          <FormField :label="t('common.status')">
            <Select v-model="newStatus">
              <SelectTrigger class="w-full">
                <SelectValue :placeholder="t('common.status')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem v-for="(label, key) in statusOptions" :key="key" :value="key">
                  {{ label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField :label="t('orders.statusMessage')">
            <Textarea v-model="statusMessage" rows="2" />
          </FormField>
        </div>
        <template #footer>
          <Button variant="outline" @click="statusDialog = false">{{ t('common.cancel') }}</Button>
          <Button :disabled="savingStatus" @click="changeStatus">
            <Loader2 v-if="savingStatus" class="animate-spin" />
            {{ t('common.confirm') }}
          </Button>
        </template>
      </Modal>

      <Modal :open="deliverDialog" :title="t('orders.manualDeliver')" @close="deliverDialog = false">
        <FormField :label="t('orders.manualDeliverContent')">
          <Textarea v-model="deliverContent" rows="6" :placeholder="t('orders.manualDeliverContentPlaceholder')" />
        </FormField>
        <template #footer>
          <Button variant="outline" @click="deliverDialog = false">{{ t('common.cancel') }}</Button>
          <Button :disabled="delivering" @click="manualDeliver">
            <Loader2 v-if="delivering" class="animate-spin" />
            {{ t('common.confirm') }}
          </Button>
        </template>
      </Modal>
    </template>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { api } from '@/shared/api/client'
import { fmtDate } from '@/shared/formatting/format'
import { statusBadgeClass } from '@/shared/formatting/status'
import { useSessionStore } from '@/stores/session'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/shared/components/ui/select'
import { Textarea } from '@/shared/components/ui/textarea'
import Modal from '@/shared/components/Modal.vue'
import FormField from '@/shared/components/FormField.vue'
import { confirm } from '@/shared/components/confirm'
import { toastError, toastSuccess, toastWarning } from '@/shared/components/toast'

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
function logDotClass(log: any) {
  if (log.event === 'payment_success' || log.event === 'delivered') return 'bg-emerald-500'
  if (log.event.includes('failed')) return 'bg-destructive'
  return 'bg-primary'
}
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  return fmtDate(ts)
}
onMounted(load)
</script>
