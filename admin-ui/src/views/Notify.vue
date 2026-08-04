<template>
  <el-card v-loading="loading">
    <template #header><h2>{{ t('notify.title') }}</h2></template>
    <el-form label-position="top" :model="form" style="max-width:680px">
      <el-form-item :label="t('notify.smtpHost')"><el-input v-model="form.smtp_host" /></el-form-item>
      <el-form-item :label="t('notify.smtpPort')"><el-input-number v-model="form.smtp_port" :min="1" /></el-form-item>
      <el-form-item :label="t('notify.smtpUsername')"><el-input v-model="form.smtp_username" :placeholder="t('notify.smtpUsernamePlaceholder')" /></el-form-item>
      <el-form-item :label="t('notify.smtpPassword')"><el-input v-model="form.smtp_password" type="password" :placeholder="t('notify.smtpPasswordPlaceholder')" show-password /></el-form-item>
      <el-form-item :label="t('notify.smtpFrom')"><el-input v-model="form.smtp_from" /></el-form-item>
      <el-form-item :label="t('notify.telegramChatId')"><el-input v-model="form.telegram_chat_id" /></el-form-item>
      <el-form-item :label="t('notify.telegramToken')"><el-input v-model="form.telegram_bot_token" type="password" :placeholder="t('notify.telegramTokenPlaceholder')" show-password /></el-form-item>
      <el-form-item :label="t('notify.webhookUrl')"><el-input v-model="form.webhook_url" :placeholder="t('notify.webhookPlaceholder')" /></el-form-item>
      <el-form-item :label="t('notify.events')">
        <el-checkbox-group v-model="events">
          <el-checkbox value="order_created">{{ t('notify.eventOrderCreated') }}</el-checkbox>
          <el-checkbox value="payment_success">{{ t('notify.eventPaymentSuccess') }}</el-checkbox>
          <el-checkbox value="delivered">{{ t('notify.eventDelivered') }}</el-checkbox>
          <el-checkbox value="low_stock">{{ t('notify.eventLowStock') }}</el-checkbox>
          <el-checkbox value="system_error">{{ t('notify.eventSystemError') }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-divider content-position="left">{{ t('notify.paidTemplates') }}</el-divider>
      <el-form-item :label="t('notify.mailSubject')"><el-input v-model="form.mail_paid_subject" /></el-form-item>
      <el-form-item :label="t('notify.mailBody')"><el-input v-model="form.mail_paid_body" type="textarea" :rows="8" /></el-form-item>
      <el-form-item :label="t('notify.telegramBody')"><el-input v-model="form.telegram_paid_body" type="textarea" :rows="6" /></el-form-item>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </el-form>
  </el-card>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { api } from '@/api'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})
const events = ref<string[]>([])

onMounted(async () => {
  loading.value = true
  try {
    form.value = await api.get('/admin/notify')
    form.value.smtp_username = ''
    form.value.smtp_password = ''
    form.value.telegram_bot_token = ''
    events.value = String(form.value.notify_events || '').split(',').filter(Boolean)
  } finally {
    loading.value = false
  }
})
async function save() {
  saving.value = true
  try {
    await api.post('/admin/notify', { ...form.value, notify_events: events.value.join(',') })
    ElMessage.success(t('notify.saved'))
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>
