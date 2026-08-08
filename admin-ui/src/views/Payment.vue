<template>
  <PageCard :title="t('payment.title')" :loading="loading">
    <el-form label-position="top" :model="form" style="max-width:640px">
      <el-form-item :label="t('payment.baseUrl')"><el-input v-model="form.bepusdt_base_url" /></el-form-item>
      <el-form-item :label="t('payment.apiToken')"><el-input v-model="form.bepusdt_api_token" type="password" :placeholder="t('payment.apiTokenPlaceholder')" show-password /></el-form-item>
      <el-form-item :label="t('payment.fiat')"><el-input v-model="form.fiat" /></el-form-item>
      <el-form-item :label="t('payment.tradeTypes')"><el-input v-model="form.trade_types" type="textarea" :rows="3" /></el-form-item>
      <el-form-item :label="t('payment.timeout')"><el-input-number v-model="form.bepusdt_timeout_sec" :min="1" /></el-form-item>
      <el-form-item :label="t('payment.notifyPath')"><el-input v-model="form.bepusdt_notify_path" :placeholder="t('payment.notifyPathPlaceholder')" /></el-form-item>
      <el-form-item :label="t('payment.notifyUrl')"><el-input v-model="form.bepusdt_notify_url" /></el-form-item>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </el-form>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'

const { t } = useI18n()
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
    ElMessage.success(t('payment.saved'))
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>
