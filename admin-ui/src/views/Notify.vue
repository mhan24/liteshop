<template>
  <el-card v-loading="loading">
    <template #header><h2>通知设置</h2></template>
    <el-form label-position="top" :model="form" style="max-width:680px">
      <el-form-item label="SMTP Host"><el-input v-model="form.smtp_host" /></el-form-item>
      <el-form-item label="SMTP Port"><el-input-number v-model="form.smtp_port" :min="1" /></el-form-item>
      <el-form-item label="SMTP Username"><el-input v-model="form.smtp_username" /></el-form-item>
      <el-form-item label="SMTP Password"><el-input v-model="form.smtp_password" type="password" placeholder="留空保持不变" show-password /></el-form-item>
      <el-form-item label="SMTP From"><el-input v-model="form.smtp_from" /></el-form-item>
      <el-form-item label="Telegram Chat ID"><el-input v-model="form.telegram_chat_id" /></el-form-item>
      <el-form-item label="Telegram Bot Token"><el-input v-model="form.telegram_bot_token" type="password" placeholder="留空保持不变" show-password /></el-form-item>
      <el-form-item label="邮件主题模板"><el-input v-model="form.mail_paid_subject" /></el-form-item>
      <el-form-item label="邮件正文模板"><el-input v-model="form.mail_paid_body" type="textarea" :rows="8" /></el-form-item>
      <el-form-item label="Telegram 正文模板"><el-input v-model="form.telegram_paid_body" type="textarea" :rows="6" /></el-form-item>
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
    form.value = await api.get('/admin/notify')
    form.value.smtp_password = ''
    form.value.telegram_bot_token = ''
  } finally {
    loading.value = false
  }
})
async function save() {
  saving.value = true
  try {
    await api.post('/admin/notify', form.value)
    ElMessage.success('已保存')
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>
