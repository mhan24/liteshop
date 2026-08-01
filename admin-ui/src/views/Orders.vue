<template>
  <div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
      <h2>订单管理</h2>
      <el-button @click="exportCSV">导出 CSV</el-button>
    </div>
    <el-table :data="pagedOrders" v-loading="loading" size="large">
      <el-table-column prop="id" label="ID" width="70" />
      <el-table-column prop="order_no" label="订单号" />
      <el-table-column prop="product_name" label="商品" />
      <el-table-column label="金额">
        <template #default="{ row }">{{ money(row.amount_cents) }} {{ row.fiat }}</template>
      </el-table-column>
      <el-table-column prop="buyer_contact" label="联系方式" />
      <el-table-column label="状态">
        <template #default="{ row }">
          <el-tag :type="statusType(row.status)">{{ statusText(row.status) }}</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="创建时间" width="170">
        <template #default="{ row }">{{ date(row.created_at) }}</template>
      </el-table-column>
      <el-table-column label="操作" width="100">
        <template #default="{ row }">
          <el-button size="small" @click="$router.push('/orders/' + row.id)">详情</el-button>
        </template>
      </el-table-column>
    </el-table>
    <div style="display:flex;justify-content:flex-end;margin-top:12px">
      <el-pagination v-if="orders.length" background layout="prev, pager, next, total" :total="orders.length" :page-size="pageSize" v-model:current-page="currentPage" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { api } from '@/api'

const orders = ref<any[]>([])
const loading = ref(false)
const currentPage = ref(1)
const pageSize = ref(20)
const pagedOrders = computed(() => orders.value.slice((currentPage.value - 1) * pageSize.value, currentPage.value * pageSize.value))

onMounted(async () => {
  loading.value = true
  try {
    orders.value = (await api.get('/admin/orders')).orders || []
  } finally {
    loading.value = false
  }
})
function statusText(status: string) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '创建失败' }[status] || status
}
function statusType(status: string): any {
  return { paid: 'success', pending: 'warning', expired: 'danger', failed: 'info' }[status] || 'info'
}
function money(c: number) {
  return ((c || 0) / 100).toFixed(2)
}
function date(ts: number) {
  if (!ts) return '-'
  return new Date(ts * 1000).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })
}
function exportCSV() {
  window.location.href = '/api/v1/admin/orders/export'
}
</script>
