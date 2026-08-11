<template>
  <PageCard :title="t('payment.title')" :loading="loading">
    <div class="max-w-2xl space-y-4">
      <FormField :label="t('payment.gateway')">
        <div class="flex flex-wrap gap-6">
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="enabled.bepusdt" type="checkbox" class="checkbox checkbox-primary checkbox-sm" @change="syncGateway" />
            <span class="text-sm">{{ t('payment.bepusdtEnabled') }}</span>
          </label>
          <label class="flex cursor-pointer items-center gap-2">
            <input v-model="enabled.hashpay" type="checkbox" class="checkbox checkbox-primary checkbox-sm" @change="syncGateway" />
            <span class="text-sm">{{ t('payment.hashpayEnabled') }}</span>
          </label>
        </div>
      </FormField>

      <div class="divider">{{ t('payment.bepusdtSection') }}</div>
      <template v-if="enabled.bepusdt">
        <FormField :label="t('payment.gatewayName')" :hint="t('payment.gatewayNamePlaceholder')">
          <input v-model="form.gateway_bepusdt_name" maxlength="40" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.gatewayDesc')">
          <textarea v-model="form.gateway_bepusdt_desc" class="textarea textarea-bordered w-full" rows="2" maxlength="200"></textarea>
        </FormField>
        <FormField :label="t('payment.gatewayPriority')">
          <input v-model.number="form.gateway_bepusdt_priority" type="number" min="-1" max="99" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.baseUrl')">
          <input v-model="form.bepusdt_base_url" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.apiToken')" :hint="t('payment.apiTokenPlaceholder')">
          <input v-model="form.bepusdt_api_token" type="password" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.fiat')">
          <input v-model="form.fiat" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.tradeTypes')">
          <textarea v-model="form.trade_types" class="textarea textarea-bordered w-full" rows="3"></textarea>
        </FormField>
        <FormField :label="t('payment.timeout')">
          <input v-model.number="form.bepusdt_timeout_sec" type="number" min="1" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.notifyPath')" :hint="t('payment.notifyPathPlaceholder')">
          <input v-model="form.bepusdt_notify_path" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.notifyUrl')">
          <input v-model="form.bepusdt_notify_url" class="input input-bordered w-full" />
        </FormField>
      </template>

      <div class="divider">{{ t('payment.hashpaySection') }}</div>
      <template v-if="enabled.hashpay">
        <div class="alert alert-info text-sm">
          <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="16" x2="12" y2="12" />
            <line x1="12" y1="8" x2="12.01" y2="8" />
          </svg>
          {{ t('payment.hashpayHint') }}
        </div>
        <FormField :label="t('payment.gatewayName')" :hint="t('payment.gatewayNamePlaceholder')">
          <input v-model="form.gateway_hashpay_name" maxlength="40" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.gatewayDesc')">
          <textarea v-model="form.gateway_hashpay_desc" class="textarea textarea-bordered w-full" rows="2" maxlength="200"></textarea>
        </FormField>
        <FormField :label="t('payment.gatewayPriority')">
          <input v-model.number="form.gateway_hashpay_priority" type="number" min="-1" max="99" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.hashpayBaseUrl')">
          <input v-model="form.hashpay_base_url" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.hashpayMerchantId')">
          <input v-model="form.hashpay_merchant_id" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.hashpayPrivateKey')" :hint="t('payment.hashpayPrivateKeyPlaceholder')">
          <textarea v-model="form.hashpay_private_key" class="textarea textarea-bordered w-full font-mono" rows="5"></textarea>
        </FormField>
        <FormField :label="t('payment.hashpayCurrency')">
          <input v-model="form.hashpay_currency" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.notifyPath')" :hint="t('payment.hashpayNotifyPathPlaceholder')">
          <input v-model="form.hashpay_notify_path" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('payment.notifyUrl')">
          <input v-model="form.hashpay_notify_url" class="input input-bordered w-full" />
        </FormField>
      </template>

      <FormField :label="t('payment.publicBaseUrl')">
        <input v-model="form.shop_public_base_url" class="input input-bordered w-full" />
      </FormField>

      <button class="btn btn-primary" :class="{ 'btn-disabled': saving }" @click="save">
        <span v-if="saving" class="loading loading-spinner loading-xs"></span>
        {{ t('common.save') }}
      </button>
    </div>
  </PageCard>
</template>

<script setup lang="ts">
import { ref, reactive, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import FormField from '@/components/ui/FormField.vue'
import { toastError, toastSuccess } from '@/components/ui/toast'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const form = ref<any>({})
const enabled = reactive({ bepusdt: true, hashpay: false })

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
