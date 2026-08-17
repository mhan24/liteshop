<template>
  <PageCard :title="t('payment.title')" :loading="loading">
    <div class="max-w-2xl">
      <div class="mb-5 flex items-center gap-1 border-b">
        <button
          type="button"
          class="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'general'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'general'"
        >
          {{ t('payment.tabGeneral') }}
        </button>
        <button
          type="button"
          class="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'bepusdt'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'bepusdt'"
        >
          {{ t('payment.tabBepusdt') }}
        </button>
        <button
          type="button"
          class="rounded-t-lg px-4 py-2 text-sm font-medium transition-colors"
          :class="
            activeTab === 'hashpay'
              ? 'border-b-2 border-primary text-primary'
              : 'text-muted-foreground hover:text-foreground'
          "
          @click="activeTab = 'hashpay'"
        >
          {{ t('payment.tabHashpay') }}
        </button>
      </div>

      <!-- 通用 -->
      <div v-if="activeTab === 'general'" class="space-y-5">
        <FormField :label="t('payment.gateway')">
          <div class="flex flex-wrap gap-6">
            <div class="flex items-center gap-2">
              <Checkbox
                id="gw-bepusdt"
                :model-value="enabled.bepusdt"
                @update:model-value="onGateway('bepusdt', $event === true)"
              />
              <Label for="gw-bepusdt" class="text-sm">{{ t('payment.bepusdtEnabled') }}</Label>
            </div>
            <div class="flex items-center gap-2">
              <Checkbox
                id="gw-hashpay"
                :model-value="enabled.hashpay"
                @update:model-value="onGateway('hashpay', $event === true)"
              />
              <Label for="gw-hashpay" class="text-sm">{{ t('payment.hashpayEnabled') }}</Label>
            </div>
          </div>
        </FormField>
        <Button :disabled="saving" @click="save">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ t('common.save') }}
        </Button>
      </div>

      <!-- BEpusdt -->
      <div v-else-if="activeTab === 'bepusdt'" class="space-y-5">
        <template v-if="enabled.bepusdt">
          <FormField :label="t('payment.gatewayName')" :hint="t('payment.gatewayNamePlaceholder')">
            <Input v-model="form.gateway_bepusdt_name" maxlength="40" />
          </FormField>
          <FormField :label="t('payment.gatewayDesc')">
            <Textarea v-model="form.gateway_bepusdt_desc" rows="2" maxlength="200" />
          </FormField>
          <FormField :label="t('payment.gatewayPriority')">
            <Input v-model.number="form.gateway_bepusdt_priority" type="number" min="-1" max="99" />
          </FormField>
          <FormField :label="t('payment.baseUrl')">
            <Input v-model="form.bepusdt_base_url" />
          </FormField>
          <FormField :label="t('payment.apiToken')" :hint="t('payment.apiTokenPlaceholder')">
            <Input v-model="form.bepusdt_api_token" type="password" />
          </FormField>
          <FormField :label="t('payment.fiat')">
            <Input v-model="form.fiat" />
          </FormField>
          <FormField :label="t('payment.tradeTypes')">
            <Textarea v-model="form.trade_types" rows="3" />
          </FormField>
          <FormField :label="t('payment.timeout')">
            <Input v-model.number="form.bepusdt_timeout_sec" type="number" min="1" />
          </FormField>
          <FormField :label="t('payment.notifyPath')" :hint="t('payment.notifyPathPlaceholder')">
            <Input v-model="form.bepusdt_notify_path" />
          </FormField>
          <FormField :label="t('payment.notifyUrl')">
            <Input v-model="form.bepusdt_notify_url" />
          </FormField>
        </template>
        <p v-else class="text-sm text-muted-foreground">{{ t('payment.gatewayDisabledHint') }}</p>
        <Button :disabled="saving" @click="save">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ t('common.save') }}
        </Button>
      </div>

      <!-- HashPay -->
      <div v-else class="space-y-5">
        <template v-if="enabled.hashpay">
          <Alert>
            <Info class="h-4 w-4" />
            <AlertDescription>{{ t('payment.hashpayHint') }}</AlertDescription>
          </Alert>
          <FormField :label="t('payment.gatewayName')" :hint="t('payment.gatewayNamePlaceholder')">
            <Input v-model="form.gateway_hashpay_name" maxlength="40" />
          </FormField>
          <FormField :label="t('payment.gatewayDesc')">
            <Textarea v-model="form.gateway_hashpay_desc" rows="2" maxlength="200" />
          </FormField>
          <FormField :label="t('payment.gatewayPriority')">
            <Input v-model.number="form.gateway_hashpay_priority" type="number" min="-1" max="99" />
          </FormField>
          <FormField :label="t('payment.hashpayBaseUrl')">
            <Input v-model="form.hashpay_base_url" />
          </FormField>
          <FormField :label="t('payment.hashpayMerchantId')">
            <Input v-model="form.hashpay_merchant_id" />
          </FormField>
          <FormField :label="t('payment.hashpayPrivateKey')" :hint="t('payment.hashpayPrivateKeyPlaceholder')">
            <Textarea v-model="form.hashpay_private_key" class="font-mono" rows="5" />
          </FormField>
          <FormField :label="t('payment.hashpayCurrency')">
            <Input v-model="form.hashpay_currency" />
          </FormField>
          <FormField :label="t('payment.notifyPath')" :hint="t('payment.hashpayNotifyPathPlaceholder')">
            <Input v-model="form.hashpay_notify_path" />
          </FormField>
          <FormField :label="t('payment.notifyUrl')">
            <Input v-model="form.hashpay_notify_url" />
          </FormField>
        </template>
        <p v-else class="text-sm text-muted-foreground">{{ t('payment.gatewayDisabledHint') }}</p>
        <Button :disabled="saving" @click="save">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ t('common.save') }}
        </Button>
      </div>
    </div>
  </PageCard>

  <ResultModal v-model:open="result.modal.open" :type="result.modal.type" :title="result.modal.title" :message="result.modal.message" />
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Loader2 } from '@lucide/vue'
import { api } from '@/shared/api/client'
import PageCard from '@/shared/components/PageCard.vue'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Button } from '@/shared/components/ui/button'
import { Checkbox } from '@/shared/components/ui/checkbox'
import { Input } from '@/shared/components/ui/input'
import { Label } from '@/shared/components/ui/label'
import { Textarea } from '@/shared/components/ui/textarea'
import FormField from '@/shared/components/FormField.vue'
import { useResult } from '@/shared/composables/useResult'
import ResultModal from '@/shared/components/ResultModal.vue'

const result = useResult()

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})
const enabled = reactive({ bepusdt: true, hashpay: false })
const activeTab = ref<'general' | 'bepusdt' | 'hashpay'>('general')

function onGateway(name: 'bepusdt' | 'hashpay', v: boolean) {
  enabled[name] = v
  syncGateway()
}

function syncGateway() {
  const list: string[] = []
  if (enabled.bepusdt) list.push('bepusdt')
  if (enabled.hashpay) list.push('hashpay')
  form.value.payment_gateway = list.length ? list.join(',') : 'bepusdt'
}

onMounted(async () => {
  loading.value = true
  try {
    const data = await api.get('/admin/settings')
    // 启用列表以 payment_gateways 数组为准（payment_gateway 仅为主网关，双网关并存时会漏）。
    const gateways: string[] =
      Array.isArray(data.payment_gateways) && data.payment_gateways.length
        ? data.payment_gateways
        : (data.payment_gateway || 'bepusdt').split(',').filter(Boolean)
    form.value = { ...data, payment_gateway: gateways.join(',') }
    enabled.bepusdt = gateways.includes('bepusdt')
    enabled.hashpay = gateways.includes('hashpay')
    form.value.gateway_bepusdt_priority =
      form.value.gateway_bepusdt_priority === undefined || form.value.gateway_bepusdt_priority === ''
        ? 0
        : Number(form.value.gateway_bepusdt_priority)
    form.value.gateway_hashpay_priority =
      form.value.gateway_hashpay_priority === undefined || form.value.gateway_hashpay_priority === ''
        ? 1
        : Number(form.value.gateway_hashpay_priority)
    form.value.bepusdt_api_token = ''
    form.value.hashpay_private_key = ''
  } finally {
    loading.value = false
  }
})
async function save() {
  syncGateway()
  saving.value = true
  try {
    await api.post('/admin/settings', form.value)
    result.success(t('payment.saved'))
  } catch (e: any) {
    result.error(e.message)
  } finally {
    saving.value = false
  }
}
</script>
