<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('orders.title') }}</h2>
      <div class="flex items-center gap-2">
        <button v-if="selected.length" class="btn btn-warning btn-sm" @click="batchResend">
          {{ t('orders.batchResend') }} ({{ selected.length }})
        </button>
        <button class="btn btn-outline btn-sm" @click="exportCSV">{{ t('common.exportCsv') }}</button>
      </div>
    </div>

    <div class="card mb-4 bg-base-100 shadow-sm ring-1 ring-base-300">
      <div class="card-body">
        <form class="flex flex-wrap items-end gap-3" @submit.prevent="search">
          <FormField :label="t('orders.searchPlaceholder')">
            <input
              v-model="filters.q"
              class="input input-bordered input-sm w-56"
              :placeholder="t('orders.searchPlaceholder')"
            />
          </FormField>
          <FormField :label="t('orders.allStatus')">
            <select v-model="filters.status" class="select select-bordered select-sm w-40">
              <option value="">{{ t('orders.allStatus') }}</option>
              <option v-for="(label, key) in statusOptions" :key="key" :value="key">{{ label }}</option>
            </select>
          </FormField>
          <FormField :label="t('orders.startDate')">
            <input v-model="rangeStart" type="datetime-local" class="input input-bordered input-sm w-52" />
          </FormField>
          <FormField :label="t('orders.endDate')">
            <input v-model="rangeEnd" type="datetime-local" class="input input-bordered input-sm w-52" />
          </FormField>
          <div class="flex items-center gap-2">
            <button class="btn btn-primary btn-sm" type="submit">{{ t('orders.search') }}</button>
            <button class="btn btn-ghost btn-sm" type="button" @click="reset">{{ t('orders.reset') }}</button>
          </div>
        </form>
      </div>
    </div>

    <div class="card bg-base-100 shadow-sm ring-1 ring-base-300">
      <div class="card-body !p-0">
        <DataTable :columns="columns" :rows="pagedOrders" :loading="loading" :empty-text="t('audit.empty')">
          <template #select="{ row }">
            <input
              type="checkbox"
              class="checkbox checkbox-primary checkbox-sm"
              :checked="selected.includes(row.id)"
              @change="toggleSelect(row.id)"
            />
          </template>
          <template #amount="{ row }">{{ money(row.amount_cents) }} {{ row.fiat }}</template>
          <template #status="{ row }">
            <span class="badge badge-sm" :class="statusBadgeClass(row.status)">{{ statusText(row.status) }}</span>
          </template>
          <template #createdAt="{ row }">{{ date(row.created_at) }}</template>
          <template #actions="{ row }">
            <button class="btn btn-ghost btn-xs" @click="$router.push('/orders/' + row.id)">
              {{ t('common.detail') }}
            </button>
          </template>
        </DataTable>
      </div>
    </div>

    <PaginationBar v-model:page="currentPage" :total="orders.length" :page-size="pageSize" />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'
import { statusBadgeClass } from '@/utils/status'
import DataTable, { type DataColumn } from '@/components/ui/DataTable.vue'
import PaginationBar from '@/components/ui/PaginationBar.vue'
import FormField from '@/components/ui/FormField.vue'
import { toastError, toastSuccess } from '@/components/ui/toast'

const { t } = useI18n()
const orders = ref<any[]>([])
const selected = ref<number[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const rangeStart = ref('')
const rangeEnd = ref('')
const filters = reactive({ q: '', status: '' })
const route = useRoute()
if (typeof route.query.status === 'string') filters.status = route.query.status

const columns = computed<DataColumn[]>(() => [
  { slot: 'select', label: '', width: '45px' },
  { key: 'id', label: t('common.id'), width: '70px' },
  { key: 'order_no', label: t('orders.orderNo') },
  { key: 'product_name', label: t('orders.product') },
  { slot: 'amount', label: t('orders.amount'), align: 'right' },
  { key: 'buyer_contact', label: t('orders.contact') },
  { slot: 'status', label: t('common.status'), width: '110px' },
  { slot: 'createdAt', label: t('orders.createdAt'), width: '170px' },
  { slot: 'actions', label: t('common.actions'), width: '100px' },
])

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

const pagedOrders = computed(() =>
  orders.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value),
)

function toUnix(local: string): number | undefined {
  if (!local) return undefined
  const v = new Date(local)
  return isNaN(v.getTime()) ? undefined : Math.floor(v.getTime() / 1000)
}

async function load() {
  loading.value = true
  currentPage.value = 1
  try {
    const params: any = {}
    if (filters.q) params.q = filters.q
    if (filters.status) params.status = filters.status
    const start = toUnix(rangeStart.value)
    const end = toUnix(rangeEnd.value)
    if (start) params.start = start
    if (end) params.end = end
    orders.value = (await api.get('/admin/orders', params)).orders || []
  } finally {
    loading.value = false
  }
}
function search() {
  load()
}
function reset() {
  filters.q = ''
  filters.status = ''
  rangeStart.value = ''
  rangeEnd.value = ''
  load()
}
onMounted(load)
function statusText(status: string) {
  return (t(`orders.status.${status}`) as string) || status
}
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  return fmtDate(ts)
}
function toggleSelect(id: number) {
  const idx = selected.value.indexOf(id)
  if (idx >= 0) selected.value.splice(idx, 1)
  else selected.value.push(id)
}
async function batchResend() {
  try {
    const res = await api.post('/admin/orders/batch-resend', { ids: selected.value })
    toastSuccess(`${t('orders.resendSent')} (${res.sent})`)
    selected.value = []
  } catch (e: any) {
    toastError(e.message)
  }
}
function exportCSV() {
  const params: any = {}
  if (filters.q) params.q = filters.q
  if (filters.status) params.status = filters.status
  const start = toUnix(rangeStart.value)
  const end = toUnix(rangeEnd.value)
  if (start) params.start = start
  if (end) params.end = end
  const qs = new URLSearchParams(params).toString()
  window.location.href = '/api/v1/admin/orders/export' + (qs ? '?' + qs : '')
}
</script>
