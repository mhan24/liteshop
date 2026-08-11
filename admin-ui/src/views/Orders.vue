<template>
  <div>
    <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h2 class="text-xl font-bold">{{ t('orders.title') }}</h2>
      <div class="flex items-center gap-2">
        <Button v-if="selected.length" variant="secondary" size="sm" @click="batchResend">
          {{ t('orders.batchResend') }} ({{ selected.length }})
        </Button>
        <Button variant="outline" size="sm" @click="exportCSV">{{ t('common.exportCsv') }}</Button>
      </div>
    </div>

    <Card class="mb-4">
      <CardContent>
        <form class="flex flex-wrap items-end gap-4" @submit.prevent="search">
          <FormField :label="t('orders.searchPlaceholder')">
            <Input
              v-model="filters.q"
              class="w-56"
              :placeholder="t('orders.searchPlaceholder')"
            />
          </FormField>
          <FormField :label="t('orders.allStatus')">
            <Select v-model="statusFilter">
              <SelectTrigger class="w-40">
                <SelectValue :placeholder="t('orders.allStatus')" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{{ t('orders.allStatus') }}</SelectItem>
                <SelectItem v-for="(label, key) in statusOptions" :key="key" :value="key">
                  {{ label }}
                </SelectItem>
              </SelectContent>
            </Select>
          </FormField>
          <FormField :label="t('orders.startDate')">
            <Input v-model="rangeStart" type="datetime-local" class="w-52" />
          </FormField>
          <FormField :label="t('orders.endDate')">
            <Input v-model="rangeEnd" type="datetime-local" class="w-52" />
          </FormField>
          <div class="flex items-center gap-2">
            <Button size="sm" type="submit">{{ t('orders.search') }}</Button>
            <Button variant="ghost" size="sm" type="button" @click="reset">{{ t('orders.reset') }}</Button>
          </div>
        </form>
      </CardContent>
    </Card>

    <Card>
      <CardContent class="p-0">
        <DataTable :columns="columns" :rows="pagedOrders" :loading="loading" :empty-text="t('audit.empty')">
          <template #select="{ row }">
            <Checkbox
              :checked="selected.includes(row.id)"
              @update:checked="toggleSelect(row.id)"
            />
          </template>
          <template #amount="{ row }">{{ money(row.amount_cents) }} {{ row.fiat }}</template>
          <template #status="{ row }">
            <Badge :class="statusBadgeClass(row.status)">{{ statusText(row.status) }}</Badge>
          </template>
          <template #createdAt="{ row }">{{ date(row.created_at) }}</template>
          <template #actions="{ row }">
            <Button variant="ghost" size="sm" class="h-7 px-2" @click="$router.push('/orders/' + row.id)">
              {{ t('common.detail') }}
            </Button>
          </template>
        </DataTable>
      </CardContent>
    </Card>

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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
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
const statusFilter = ref('all')
const route = useRoute()
if (typeof route.query.status === 'string') {
  filters.status = route.query.status
  statusFilter.value = route.query.status
}

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
  filters.status = statusFilter.value === 'all' ? '' : statusFilter.value
  load()
}
function reset() {
  filters.q = ''
  filters.status = ''
  statusFilter.value = 'all'
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
