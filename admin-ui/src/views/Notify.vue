<template>
  <PageCard :title="t('notify.title')" :loading="loading">
    <el-form label-position="top" :model="form" style="max-width: 960px">
      <el-form-item :label="t('notify.smtpHost')"><el-input v-model="form.smtp_host" /></el-form-item>
      <el-form-item :label="t('notify.smtpPort')"><el-input-number v-model="form.smtp_port" :min="1" /></el-form-item>
      <el-form-item :label="t('notify.smtpUsername')"
        ><el-input v-model="form.smtp_username" :placeholder="t('notify.smtpUsernamePlaceholder')"
      /></el-form-item>
      <el-form-item :label="t('notify.smtpPassword')"
        ><el-input
          v-model="form.smtp_password"
          type="password"
          :placeholder="t('notify.smtpPasswordPlaceholder')"
          show-password
      /></el-form-item>
      <el-form-item :label="t('notify.smtpFrom')"><el-input v-model="form.smtp_from" /></el-form-item>
      <el-form-item
        ><el-button :loading="testing === 'email'" @click="testEmail">{{
          t('notify.testEmail')
        }}</el-button></el-form-item
      >
      <el-form-item :label="t('notify.telegramChatId')"><el-input v-model="form.telegram_chat_id" /></el-form-item>
      <el-form-item :label="t('notify.telegramToken')"
        ><el-input
          v-model="form.telegram_bot_token"
          type="password"
          :placeholder="t('notify.telegramTokenPlaceholder')"
          show-password
      /></el-form-item>
      <el-form-item
        ><el-button :loading="testing === 'telegram'" @click="testTelegram">{{
          t('notify.testTelegram')
        }}</el-button></el-form-item
      >
      <el-form-item :label="t('notify.webhookUrl')"
        ><el-input v-model="form.webhook_url" :placeholder="t('notify.webhookPlaceholder')"
      /></el-form-item>
      <el-form-item :label="t('notify.webhookSecret')"
        ><el-input
          v-model="form.webhook_secret"
          type="password"
          :placeholder="t('notify.webhookSecretPlaceholder')"
          show-password
      /></el-form-item>
      <el-form-item :label="t('notify.events')">
        <el-checkbox-group v-model="events">
          <el-checkbox value="order_created">{{ t('notify.eventOrderCreated') }}</el-checkbox>
          <el-checkbox value="payment_success">{{ t('notify.eventPaymentSuccess') }}</el-checkbox>
          <el-checkbox value="delivered">{{ t('notify.eventDelivered') }}</el-checkbox>
          <el-checkbox value="low_stock">{{ t('notify.eventLowStock') }}</el-checkbox>
          <el-checkbox value="system_error">{{ t('notify.eventSystemError') }}</el-checkbox>
        </el-checkbox-group>
      </el-form-item>
      <el-divider content-position="left">{{ t('notify.eventTemplates') }}</el-divider>
      <el-form-item :label="t('notify.adminEmail')">
        <el-input v-model="form.notify_admin_email" :placeholder="t('notify.adminEmailPlaceholder')" />
      </el-form-item>
      <el-collapse>
        <el-collapse-item v-for="ev in eventList" :key="ev.key" :title="ev.label">
          <el-form-item :label="t('notify.eventTelegram')">
            <el-input
              v-model="form.event_templates[ev.key].telegram"
              type="textarea"
              :rows="5"
              :autosize="{ minRows: 5, maxRows: 14 }"
            />
          </el-form-item>
          <template v-if="ev.key === 'order_created' || ev.key === 'delivered'">
            <el-form-item :label="t('notify.eventMailSubject')">
              <el-input v-model="form.event_templates[ev.key].mail_subject" />
            </el-form-item>
            <el-form-item :label="t('notify.eventMailBody')">
              <el-input
                v-model="form.event_templates[ev.key].mail_body"
                type="textarea"
                :rows="9"
                :autosize="{ minRows: 9, maxRows: 20 }"
              />
            </el-form-item>
          </template>
          <el-form-item>
            <el-button size="small" :loading="testing === ev.key" @click="testEvent(ev.key)">{{
              t('notify.test')
            }}</el-button>
          </el-form-item>
        </el-collapse-item>
      </el-collapse>
      <el-button type="primary" :loading="saving" @click="save">{{ t('common.save') }}</el-button>
    </el-form>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { ElMessage } from 'element-plus'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})
const events = ref<string[]>([])
const testing = ref('')
const eventList = computed(() => [
  { key: 'order_created', label: t('notify.eventOrderCreated') },
  { key: 'payment_success', label: t('notify.eventPaymentSuccess') },
  { key: 'delivered', label: t('notify.eventDelivered') },
  { key: 'low_stock', label: t('notify.eventLowStock') },
  { key: 'system_error', label: t('notify.eventSystemError') },
])

onMounted(async () => {
  loading.value = true
  try {
    form.value = await api.get('/admin/notify')
    form.value.smtp_username = ''
    form.value.smtp_password = ''
    form.value.telegram_bot_token = ''
    form.value.webhook_secret = ''
    events.value = String(form.value.notify_events || '')
      .split(',')
      .filter(Boolean)
    if (!form.value.event_templates) form.value.event_templates = {}
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
async function testEvent(ev: string) {
  testing.value = ev
  try {
    await api.post('/admin/notify/test-event', { event: ev, channel: '' })
    ElMessage.success(t('notify.testSent'))
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    testing.value = ''
  }
}
async function testEmail() {
  const to =
    String(form.value.notify_admin_email || '').trim() || window.prompt(t('notify.testEmailPrompt') || '') || ''
  if (!to) {
    ElMessage.warning(t('notify.testEmailNeedAddr'))
    return
  }
  testing.value = 'email'
  try {
    await api.post('/admin/notify/test-email', { test_email: to })
    ElMessage.success(t('notify.testSent'))
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    testing.value = ''
  }
}
async function testTelegram() {
  testing.value = 'telegram'
  try {
    await api.post('/admin/notify/test-telegram', {})
    ElMessage.success(t('notify.testSent'))
  } catch (e: any) {
    ElMessage.error(e.message)
  } finally {
    testing.value = ''
  }
}
</script>
