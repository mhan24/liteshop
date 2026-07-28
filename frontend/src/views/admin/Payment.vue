<template>
  <a-spin :spinning="loading">
    <a-typography-title :level="4">支付设置</a-typography-title>
    <a-form layout="vertical" :model="form" @finish="save" style="max-width:640px">
      <a-form-item label="BEpusdt Base URL"><a-input v-model:value="form.bepusdt_base_url" /></a-form-item>
      <a-form-item label="BEpusdt API Token"><a-input-password v-model:value="form.bepusdt_api_token" placeholder="留空保持不变" /></a-form-item>
      <a-form-item label="法币"><a-input v-model:value="form.fiat" /></a-form-item>
      <a-form-item label="收款类型（逗号分隔）"><a-textarea v-model:value="form.trade_types" :rows="3" /></a-form-item>
      <a-form-item label="支付超时（秒）"><a-input-number v-model:value="form.bepusdt_timeout_sec" :min="1" style="width:100%" /></a-form-item>
      <a-form-item label="前台公开地址"><a-input v-model:value="form.shop_public_base_url" /></a-form-item>
      <a-form-item label="回调地址"><a-input v-model:value="form.bepusdt_notify_url" /></a-form-item>
      <a-button type="primary" html-type="submit" :loading="saving">保存</a-button>
    </a-form>
  </a-spin>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { message } from 'ant-design-vue'
import { api } from '@/api'
const loading = ref(false)
const saving = ref(false)
const form = ref({})
async function load() {
  loading.value = true
  try {
    form.value = await api.get('/admin/settings')
    form.value.bepusdt_api_token = ''
  } finally {
    loading.value = false
  }
}
async function save() {
  saving.value = true
  try {
    await api.post('/admin/settings', form.value)
    message.success('已保存')
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
