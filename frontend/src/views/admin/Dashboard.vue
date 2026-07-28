<template>
  <a-spin :spinning="loading">
    <a-typography-title :level="4">后台首页</a-typography-title>
    <a-row :gutter="16">
      <a-col :xs="12" :md="6"><a-statistic title="商品" :value="stats.products" /></a-col>
      <a-col :xs="12" :md="6"><a-statistic title="可用卡密" :value="stats.available_cards" /></a-col>
      <a-col :xs="12" :md="6"><a-statistic title="待支付订单" :value="stats.pending_orders" /></a-col>
      <a-col :xs="12" :md="6"><a-statistic title="已支付订单" :value="stats.paid_orders" /></a-col>
    </a-row>
  </a-spin>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { api } from '@/api'
const loading = ref(false)
const stats = ref({})
async function load() {
  loading.value = true
  try {
    stats.value = await api.get('/admin/dashboard')
  } finally {
    loading.value = false
  }
}
onMounted(load)
</script>
