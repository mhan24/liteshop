<template>
  <el-card v-loading="loading">
    <template #header><h2>支付设置</h2></template>
    <el-form label-position="top" :model="form" style="max-width:640px">
      <el-form-item label="BEpusdt Base URL"><el-input v-model="form.bepusdt_base_url" /></el-form-item>
      <el-form-item label="BEpusdt API Token"><el-input v-model="form.bepusdt_api_token" type="password" placeholder="留空保持不变" show-password /></el-form-item>
      <el-form-item label="法币"><el-input v-model="form.fiat" /></el-form-item>
      <el-form-item label="收款类型（逗号分隔）"><el-input v-model="form.trade_types" type="textarea" :rows="3" /></el-form-item>
      <el-form-item label="支付超时（秒）"><el-input-number v-model="form.bepusdt_timeout_sec" :min="1" /></el-form-item>
      <el-form-item label="前台公开地址"><el-input v-model="form.shop_public_base_url" /></el-form-item>
      <el-form-item label="回调地址"><el-input v-model="form.bepusdt_notify_url" /></el-form-item>
      <el-button type="primary" :loading="saving" @click="save">保存</el-button>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})

onMounted(async () => {
  loading.value = true
  try {
    form.value = await api.get('/admin/settings')
    form.value.bepusdt_api_token = ''
  } finally {
    loading.value = false
  }
})
async function save() {
  saving.value = true
  try {
    await api.post('/admin/settings', form.value)
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>
