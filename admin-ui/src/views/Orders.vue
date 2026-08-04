<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>{{ t('orders.title') }}</h2>
      <el-button @click="exportCSV">{{ t('common.exportCsv') }}</el-button>
    </div>
    <el-card style="margin-bottom:12px">
      <el-form :inline="true" @submit.prevent="search">
        <el-form-item>
          <el-input v-model="filters.q" :placeholder="t('orders.searchPlaceholder')" clearable style="width:220px" @keyup.enter="search" />
        </el-form-item>
        <el-form-item>
          <el-select v-model="filters.status" clearable :placeholder="t('orders.allStatus')" style="width:140px">
            <el-option v-for="(label, key) in statusOptions" :key="key" :label="label" :value="key" />
          </el-select>
        </el-form-item>
        <el-form-item>
          <el-date-picker
            v-model="filters.range"
            type="datetimerange"
            :start-placeholder="t('orders.startDate')"
            :end-placeholder="t('orders.endDate')"
            style="width:360px"
          />
        </el-form-item>
        <el-form-item>
          <el-button type="primary" native-type="submit">{{ t('orders.search') }}</el-button>
          <el-button @click="reset">{{ t('orders.reset') }}</el-button>
        </el-form-item>
      </el-form>
    </el-card>
    <el-table :data="pagedOrders" v-loading="loading" size="large">
      <el-table-column prop="id" :label="t('common.id')" width="70" />
      <el-table-column prop="order_no" :label="t('orders.orderNo')" />
      <el-table-column prop="product_name" :label="t('orders.product')" />
      <el-table-column :label="t('orders.amount')">
        <template #default="{ row }">{{ money(row.amount_cents) }} {{ row.fiat }}</template>
      </el-table-column>
      <el-table-column prop="buyer_contact" :label="t('orders.contact')" />
      <el-table-column :label="t('common.status')">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column :label="t('orders.createdAt')" width="170">
        <template #default="{ row }">{{ date(row.created_at) }}</template>
      </el-table-column>
      <el-table-column :label="t('common.actions')" width="100">
        <template #default="{ row }">
          <el-button size="small" @click="$router.push('/orders/' + row.id)">{{ t('common.detail') }}</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <el-pagination v-if="orders.length" background layout="prev, pager, next, total" :total="orders.length" :page-size="pageSize" v-model:current-page="currentPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, reactive, onMounted } from 'vue'
import { useRoute } from 'vue-router'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import { fmtDate } from '@/utils/format'

const { t } = useI18n()
const orders = ref<any[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const filters = reactive({ q: '', status: '', range: null as [Date, Date] | null })
const route = useRoute()
if (typeof route.query.status === 'string') filters.status = route.query.status
const pagedOrders = computed(() => orders.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

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
  currentPage.value = 1
  try {
    const params: any = {}
    if (filters.q) params.q = filters.q
    if (filters.status) params.status = filters.status
    if (filters.range && filters.range[0] && filters.range[1]) {
      params.start = Math.floor(filters.range[0].getTime() / 1000)
      params.end = Math.floor(filters.range[1].getTime() / 1000)
    }
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
  filters.range = null
  load()
}
onMounted(load)
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
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  return fmtDate(ts)
}
function exportCSV() {
  const params: any = {}
  if (filters.q) params.q = filters.q
  if (filters.status) params.status = filters.status
  if (filters.range && filters.range[0] && filters.range[1]) {
    params.start = Math.floor(filters.range[0].getTime() / 1000)
    params.end = Math.floor(filters.range[1].getTime() / 1000)
  }
  const qs = new URLSearchParams(params).toString()
  window.location.href = '/api/v1/admin/orders/export' + (qs ? '?' + qs : '')
}
</script>
