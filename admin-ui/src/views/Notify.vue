<template>
  <PageCard :title="t('notify.title')" :loading="loading">
    <div class="max-w-3xl space-y-5">
      <div class="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <FormField :label="t('notify.smtpHost')">
          <Input v-model="form.smtp_host" />
        </FormField>
        <FormField :label="t('notify.smtpPort')">
          <Input v-model.number="form.smtp_port" type="number" min="1" />
        </FormField>
      </div>
      <FormField :label="t('notify.smtpUsername')" :hint="t('notify.smtpUsernamePlaceholder')">
        <Input v-model="form.smtp_username" />
      </FormField>
      <FormField :label="t('notify.smtpPassword')" :hint="t('notify.smtpPasswordPlaceholder')">
        <Input v-model="form.smtp_password" type="password" />
      </FormField>
      <FormField :label="t('notify.smtpFrom')">
        <Input v-model="form.smtp_from" />
      </FormField>
      <Button variant="outline" size="sm" :disabled="testing === 'email'" @click="testEmail">
        <Loader2 v-if="testing === 'email'" class="animate-spin" />
        {{ t('notify.testEmail') }}
      </Button>

      <FormField :label="t('notify.telegramChatId')">
        <Input v-model="form.telegram_chat_id" />
      </FormField>
      <FormField :label="t('notify.telegramToken')" :hint="t('notify.telegramTokenPlaceholder')">
        <Input v-model="form.telegram_bot_token" type="password" />
      </FormField>
      <Button variant="outline" size="sm" :disabled="testing === 'telegram'" @click="testTelegram">
        <Loader2 v-if="testing === 'telegram'" class="animate-spin" />
        {{ t('notify.testTelegram') }}
      </Button>

      <FormField :label="t('notify.webhookUrl')" :hint="t('notify.webhookPlaceholder')">
        <Input v-model="form.webhook_url" />
      </FormField>
      <FormField :label="t('notify.webhookSecret')" :hint="t('notify.webhookSecretPlaceholder')">
        <Input v-model="form.webhook_secret" type="password" />
      </FormField>

      <FormField :label="t('notify.events')">
        <div class="flex flex-wrap gap-x-6 gap-y-2">
          <div v-for="ev in eventList" :key="ev.key" class="flex items-center gap-2">
            <Checkbox
              :id="'ev-' + ev.key"
              :checked="events.includes(ev.key)"
              @update:checked="toggleEvent(ev.key, $event)"
            />
            <Label :for="'ev-' + ev.key" class="text-sm">{{ ev.label }}</Label>
          </div>
        </div>
      </FormField>

      <Separator />
      <h3 class="font-semibold">{{ t('notify.eventTemplates') }}</h3>
      <FormField :label="t('notify.adminEmail')" :hint="t('notify.adminEmailPlaceholder')">
        <Input v-model="form.notify_admin_email" />
      </FormField>

      <Accordion type="single" collapsible class="w-full">
        <AccordionItem v-for="ev in eventList" :key="ev.key" :value="ev.key">
          <AccordionTrigger>{{ ev.label }}</AccordionTrigger>
          <AccordionContent class="space-y-4">
            <FormField :label="t('notify.eventTelegram')">
              <Textarea v-model="form.event_templates[ev.key].telegram" class="font-mono" rows="5" />
            </FormField>
            <template v-if="ev.key === 'order_created' || ev.key === 'delivered'">
              <FormField :label="t('notify.eventMailSubject')">
                <Input v-model="form.event_templates[ev.key].mail_subject" />
              </FormField>
              <FormField :label="t('notify.eventMailBody')">
                <Textarea v-model="form.event_templates[ev.key].mail_body" class="font-mono" rows="9" />
              </FormField>
            </template>
            <Button variant="outline" size="sm" :disabled="testing === ev.key" @click="testEvent(ev.key)">
              <Loader2 v-if="testing === ev.key" class="animate-spin" />
              {{ t('notify.test') }}
            </Button>
          </AccordionContent>
        </AccordionItem>
      </Accordion>

      <Button :disabled="saving" @click="save">
        <Loader2 v-if="saving" class="animate-spin" />
        {{ t('common.save') }}
      </Button>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2 } from '@lucide/vue'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
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

function toggleEvent(key: string, v: boolean) {
  const idx = events.value.indexOf(key)
  if (v && idx < 0) events.value.push(key)
  if (!v && idx >= 0) events.value.splice(idx, 1)
}

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
