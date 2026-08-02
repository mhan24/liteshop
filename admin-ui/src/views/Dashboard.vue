<template>
  <el-row :gutter="16">
    <el-col :xs="12" :md="6"><el-card><el-statistic :title="t('dashboard.products')" :value="stats.products" /></el-card></el-col>
    <el-col :xs="12" :md="6"><el-card><el-statistic :title="t('dashboard.availableCards')" :value="stats.available_cards" /></el-card></el-col>
    <el-col :xs="12" :md="6"><el-card><el-statistic :title="t('dashboard.pendingOrders')" :value="stats.pending_orders" /></el-card></el-col>
    <el-col :xs="12" :md="6"><el-card><el-statistic :title="t('dashboard.paidOrders')" :value="stats.paid_orders" /></el-card></el-col>
  </el-row>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'

const { t } = useI18n()
const stats = ref<any>({})
onMounted(async () => {
  stats.value = await api.get('/admin/dashboard')
})
</script>
