<template>
  <a-spin :spinning="loading">
    <a-typography-title :level="4">订单管理</a-typography-title>
    <a-table :data-source="orders" row-key="id" size="small">
      <a-table-column title="ID" data-index="id" />
      <a-table-column title="订单号" data-index="order_no" />
      <a-table-column title="商品" data-index="product_name" />
      <a-table-column title="联系方式" data-index="buyer_contact" />
      <a-table-column title="状态">
        <template #default="{ record }">
          <a-tag :color="statusColor(record.status)">{{ statusText(record.status) }}</a-tag>
        </template>
      </a-table-column>
      <a-table-column title="操作">
        <template #default="{ record }">
          <a-button size="small" @click="$router.push('/admin/orders/' + record.id)">详情</a-button>
        </template>
      </a-table-column>
    </a-table>
  </a-spin>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/api'
const loading = ref(false)
const orders = ref([])
async function load() {
  loading.value = true
  try {
    orders.value = (await api.get('/admin/orders')).orders || []
  } finally {
    loading.value = false
  }
}
onMounted(load)
function statusColor(status) {
  return { paid: 'success', pending: 'warning', expired: 'error', failed: 'default' }[status] || 'default'
}
function statusText(status) {
  return { paid: '已支付', pending: '待支付', expired: '已过期', failed: '创建失败' }[status] || status
}
</script>
