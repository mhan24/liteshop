<template>
  <PageCard :title="t('payment.title')" :loading="loading">
    <div class="max-w-2xl space-y-5">
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

      <Separator />
      <h3 class="font-semibold">{{ t('payment.bepusdtSection') }}</h3>
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

      <Separator />
      <h3 class="font-semibold">{{ t('payment.hashpaySection') }}</h3>
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

      <FormField :label="t('payment.publicBaseUrl')">
        <Input v-model="form.shop_public_base_url" />
      </FormField>

      <Button :disabled="saving" @click="save">
        <Loader2 v-if="saving" class="animate-spin" />
        {{ t('common.save') }}
      </Button>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Loader2 } from '@lucide/vue'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { Textarea } from '@/components/ui/textarea'
import FormField from '@/components/FormField.vue'
import { toastError, toastSuccess } from '@/components/toast'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})
const enabled = reactive({ bepusdt: true, hashpay: false })

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
    toastSuccess(t('payment.saved'))
  } catch (e: any) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}
</script>
