<template>
  <el-row :gutter="16">
    <el-col :xs="12" :md="6"><el-card><el-statistic title="商品" :value="stats.products" /></el-card></el-col>
    <el-col :xs="12" :md="6"><el-card><el-statistic title="可用卡密" :value="stats.available_cards" /></el-card></el-col>
    <el-col :xs="12" :md="6"><el-card><el-statistic title="待支付订单" :value="stats.pending_orders" /></el-card></el-col>
    <el-col :xs="12" :md="6"><el-card><el-statistic title="已支付订单" :value="stats.paid_orders" /></el-card></el-col>
  </el-row>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { api } from '@/api'

const stats = ref<any>({})
onMounted(async () => {
  stats.value = await api.get('/admin/dashboard')
})
</script>
