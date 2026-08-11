<template>
  <PageCard :title="t('notify.title')" :loading="loading">
    <div class="max-w-3xl space-y-4">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField :label="t('notify.smtpHost')">
          <input v-model="form.smtp_host" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('notify.smtpPort')">
          <input v-model.number="form.smtp_port" type="number" min="1" class="input input-bordered w-full" />
        </FormField>
      </div>
      <FormField :label="t('notify.smtpUsername')" :hint="t('notify.smtpUsernamePlaceholder')">
        <input v-model="form.smtp_username" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('notify.smtpPassword')" :hint="t('notify.smtpPasswordPlaceholder')">
        <input v-model="form.smtp_password" type="password" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('notify.smtpFrom')">
        <input v-model="form.smtp_from" class="input input-bordered w-full" />
      </FormField>
      <button class="btn btn-outline btn-sm" :class="{ 'btn-disabled': testing === 'email' }" @click="testEmail">
        <span v-if="testing === 'email'" class="loading loading-spinner loading-xs"></span>
        {{ t('notify.testEmail') }}
      </button>

      <FormField :label="t('notify.telegramChatId')">
        <input v-model="form.telegram_chat_id" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('notify.telegramToken')" :hint="t('notify.telegramTokenPlaceholder')">
        <input v-model="form.telegram_bot_token" type="password" class="input input-bordered w-full" />
      </FormField>
      <button class="btn btn-outline btn-sm" :class="{ 'btn-disabled': testing === 'telegram' }" @click="testTelegram">
        <span v-if="testing === 'telegram'" class="loading loading-spinner loading-xs"></span>
        {{ t('notify.testTelegram') }}
      </button>

      <FormField :label="t('notify.webhookUrl')" :hint="t('notify.webhookPlaceholder')">
        <input v-model="form.webhook_url" class="input input-bordered w-full" />
      </FormField>
      <FormField :label="t('notify.webhookSecret')" :hint="t('notify.webhookSecretPlaceholder')">
        <input v-model="form.webhook_secret" type="password" class="input input-bordered w-full" />
      </FormField>

      <FormField :label="t('notify.events')">
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <label v-for="ev in eventList" :key="ev.key" class="flex cursor-pointer items-center gap-2">
            <input v-model="events" type="checkbox" class="checkbox checkbox-primary checkbox-sm" :value="ev.key" />
            <span class="text-sm">{{ ev.label }}</span>
          </label>
        </div>
      </FormField>

      <div class="divider">{{ t('notify.eventTemplates') }}</div>
      <FormField :label="t('notify.adminEmail')" :hint="t('notify.adminEmailPlaceholder')">
        <input v-model="form.notify_admin_email" class="input input-bordered w-full" />
      </FormField>

      <details v-for="ev in eventList" :key="ev.key" class="collapse collapse-arrow rounded-box bg-base-200/70">
        <summary class="collapse-title text-sm font-medium">{{ ev.label }}</summary>
        <div class="collapse-content space-y-4">
          <FormField :label="t('notify.eventTelegram')">
            <textarea v-model="form.event_templates[ev.key].telegram" class="textarea textarea-bordered w-full font-mono" rows="5"></textarea>
          </FormField>
          <template v-if="ev.key === 'order_created' || ev.key === 'delivered'">
            <FormField :label="t('notify.eventMailSubject')">
              <input v-model="form.event_templates[ev.key].mail_subject" class="input input-bordered w-full" />
            </FormField>
            <FormField :label="t('notify.eventMailBody')">
              <textarea v-model="form.event_templates[ev.key].mail_body" class="textarea textarea-bordered w-full font-mono" rows="9"></textarea>
            </FormField>
          </template>
          <button class="btn btn-outline btn-sm" :class="{ 'btn-disabled': testing === ev.key }" @click="testEvent(ev.key)">
            <span v-if="testing === ev.key" class="loading loading-spinner loading-xs"></span>
            {{ t('notify.test') }}
          </button>
        </div>
      </details>

      <button class="btn btn-primary" :class="{ 'btn-disabled': saving }" @click="save">
        <span v-if="saving" class="loading loading-spinner loading-xs"></span>
        {{ t('common.save') }}
      </button>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import FormField from '@/components/ui/FormField.vue'
import { toastError, toastSuccess, toastWarning } from '@/components/ui/toast'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const EVENT_KEYS = ['order_created', 'payment_success', 'delivered', 'low_stock', 'system_error']
const blankTemplate = () => ({ telegram: '', mail_subject: '', mail_body: '' })
const form = ref<any>({
  event_templates: Object.fromEntries(EVENT_KEYS.map((k) => [k, blankTemplate()])),
})
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
    for (const key of EVENT_KEYS) {
      if (!form.value.event_templates[key]) form.value.event_templates[key] = blankTemplate()
    }
  } finally {
    loading.value = false
  }
})
async function save() {
  saving.value = true
  try {
    await api.post('/admin/notify', { ...form.value, notify_events: events.value.join(',') })
    toastSuccess(t('notify.saved'))
  } catch (e: any) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}
async function testEvent(ev: string) {
  testing.value = ev
  try {
    await api.post('/admin/notify/test-event', { event: ev, channel: '' })
    toastSuccess(t('notify.testSent'))
  } catch (e: any) {
    toastError(e.message)
  } finally {
    testing.value = ''
  }
}
async function testEmail() {
  const to =
    String(form.value.notify_admin_email || '').trim() || window.prompt(t('notify.testEmailPrompt') || '') || ''
  if (!to) {
    toastWarning(t('notify.testEmailNeedAddr'))
    return
  }
  testing.value = 'email'
  try {
    await api.post('/admin/notify/test-email', { test_email: to })
    toastSuccess(t('notify.testSent'))
  } catch (e: any) {
    toastError(e.message)
  } finally {
    testing.value = ''
  }
}
async function testTelegram() {
  testing.value = 'telegram'
  try {
    await api.post('/admin/notify/test-telegram', {})
    toastSuccess(t('notify.testSent'))
  } catch (e: any) {
    toastError(e.message)
  } finally {
    testing.value = ''
  }
}
</script>
