<template>
  <a-spin :spinning="loading">
    <a-typography-title :level="4">通知设置</a-typography-title>
    <a-form layout="vertical" :model="form" @finish="save" style="max-width:680px">
      <a-form-item label="SMTP Host"><a-input v-model:value="form.smtp_host" /></a-form-item>
      <a-form-item label="SMTP Port"><a-input-number v-model:value="form.smtp_port" :min="1" style="width:100%" /></a-form-item>
      <a-form-item label="SMTP Username"><a-input v-model:value="form.smtp_username" /></a-form-item>
      <a-form-item label="SMTP Password"><a-input-password v-model:value="form.smtp_password" placeholder="留空保持不变" /></a-form-item>
      <a-form-item label="SMTP From"><a-input v-model:value="form.smtp_from" /></a-form-item>
      <a-form-item label="Telegram Chat ID"><a-input v-model:value="form.telegram_chat_id" /></a-form-item>
      <a-form-item label="Telegram Bot Token"><a-input-password v-model:value="form.telegram_bot_token" placeholder="留空保持不变" /></a-form-item>
      <a-form-item label="邮件主题模板"><a-input v-model:value="form.mail_paid_subject" /></a-form-item>
      <a-form-item label="邮件正文模板"><a-textarea v-model:value="form.mail_paid_body" :rows="8" /></a-form-item>
      <a-form-item label="Telegram 正文模板"><a-textarea v-model:value="form.telegram_paid_body" :rows="6" /></a-form-item>
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
    form.value = await api.get('/admin/notify')
    form.value.smtp_password = ''
    form.value.telegram_bot_token = ''
  } finally {
    loading.value = false
  }
}
async function save() {
  saving.value = true
  try {
    await api.post('/admin/notify', form.value)
    message.success('已保存')
  } catch (e) {
    message.error(e.message)
  } finally {
    saving.value = false
  }
}
onMounted(load)
</script>
