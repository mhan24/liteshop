<template>
  <PageCard :title="t('payment.title')" :loading="loading">
    <el-form label-position="top" :model="form" style="max-width: 640px">
      <el-form-item :label="t('payment.gateway')">
        <el-radio-group v-model="form.payment_gateway">
          <el-radio value="bepusdt">BEpusdt</el-radio>
          <el-radio value="hashpay">HashPay</el-radio>
        </el-radio-group>
      </el-form-item>

      <el-divider>{{ t('payment.bepusdtSection') }}</el-divider>
      <template v-if="form.payment_gateway === 'bepusdt'">
        <el-form-item :label="t('payment.baseUrl')"><el-input v-model="form.bepusdt_base_url" /></el-form-item>
        <el-form-item :label="t('payment.apiToken')"
          ><el-input
            v-model="form.bepusdt_api_token"
            type="password"
            :placeholder="t('payment.apiTokenPlaceholder')"
            show-password
        /></el-form-item>
        <el-form-item :label="t('payment.fiat')"><el-input v-model="form.fiat" /></el-form-item>
        <el-form-item :label="t('payment.tradeTypes')"
          ><el-input v-model="form.trade_types" type="textarea" :rows="3"
        /></el-form-item>
        <el-form-item :label="t('payment.timeout')"
          ><el-input-number v-model="form.bepusdt_timeout_sec" :min="1"
        /></el-form-item>
        <el-form-item :label="t('payment.notifyPath')"
          ><el-input v-model="form.bepusdt_notify_path" :placeholder="t('payment.notifyPathPlaceholder')"
        /></el-form-item>
        <el-form-item :label="t('payment.notifyUrl')"><el-input v-model="form.bepusdt_notify_url" /></el-form-item>
      </template>

      <el-divider>{{ t('payment.hashpaySection') }}</el-divider>
      <template v-if="form.payment_gateway === 'hashpay'">
        <el-form-item :label="t('payment.hashpayBaseUrl')"><el-input v-model="form.hashpay_base_url" /></el-form-item>
        <el-form-item :label="t('payment.hashpayMerchantId')"><el-input v-model="form.hashpay_merchant_id" /></el-form-item>
        <el-form-item :label="t('payment.hashpayPrivateKey')"
          ><el-input
            v-model="form.hashpay_private_key"
            type="textarea"
            :rows="5"
            :placeholder="t('payment.hashpayPrivateKeyPlaceholder')"
        /></el-form-item>
        <el-form-item :label="t('payment.hashpayCurrency')"><el-input v-model="form.hashpay_currency" /></el-form-item>
        <el-form-item :label="t('payment.notifyPath')"
          ><el-input v-model="form.hashpay_notify_path" :placeholder="t('payment.hashpayNotifyPathPlaceholder')"
        /></el-form-item>
        <el-form-item :label="t('payment.notifyUrl')"><el-input v-model="form.hashpay_notify_url" /></el-form-item>
        <el-alert type="info" :closable="false" show-icon :title="t('payment.hashpayHint')" style="margin-bottom: 12px" />
      </template>

      <el-form-item :label="t('payment.publicBaseUrl')"><el-input v-model="form.shop_public_base_url" /></el-form-item>
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
    const data = await api.get('/admin/settings')
    form.value = { ...data, payment_gateway: data.payment_gateway || 'bepusdt' }
    form.value.bepusdt_api_token = ''
    form.value.hashpay_private_key = ''
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
