<template>
  <div class="space-y-4">
    <PageCard :title="t('account.title')" :loading="loading">
      <div class="max-w-md space-y-4">
        <FormField :label="t('account.username')" required>
          <input v-model="form.username" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('account.currentPassword')" required>
          <input v-model="form.current_password" type="password" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('account.newPassword')">
          <input v-model="form.new_password" type="password" class="input input-bordered w-full" />
        </FormField>
        <FormField :label="t('account.confirmPassword')">
          <input v-model="form.confirm_password" type="password" class="input input-bordered w-full" />
        </FormField>
        <button class="btn btn-primary" :class="{ 'btn-disabled': saving }" @click="save">
          <span v-if="saving" class="loading loading-spinner loading-xs"></span>
          {{ t('common.save') }}
        </button>
      </div>
    </PageCard>

    <PageCard :title="t('account.totp')" :loading="totpLoading">
      <div v-if="!totp.enabled" class="max-w-md space-y-4">
        <p class="text-sm opacity-70">{{ t('account.totpHint') }}</p>
        <button class="btn btn-primary btn-sm" @click="generateTotp">{{ t('account.totpGenerate') }}</button>

        <div v-if="totp.secret" class="rounded-xl bg-base-200/70 p-4">
          <div class="alert alert-info text-sm">
            <svg class="h-5 w-5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10" />
              <line x1="12" y1="16" x2="12" y2="12" />
              <line x1="12" y1="8" x2="12.01" y2="8" />
            </svg>
            {{ t('account.totpScanHint') }}
          </div>
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="TOTP QR" class="mt-3 h-48 w-48 rounded-lg border border-base-300 bg-white p-1" />
          <p class="mt-2 text-sm opacity-70">
            {{ t('account.totpSecret') }}: <code class="mono font-semibold">{{ totp.secret }}</code>
          </p>
          <p class="mono mt-1 text-xs opacity-60">{{ otpauth }}</p>
          <div class="mt-3 flex items-center gap-2">
            <input v-model="totpCode" class="input input-bordered input-sm w-40" :placeholder="t('account.totpCodePlaceholder')" />
            <button class="btn btn-primary btn-sm" :class="{ 'btn-disabled': totpSaving }" @click="enableTotp">
              <span v-if="totpSaving" class="loading loading-spinner loading-xs"></span>
              {{ t('account.totpConfirm') }}
            </button>
          </div>
        </div>
      </div>

      <div v-else class="max-w-md space-y-4">
        <span class="badge badge-success">{{ t('account.totpEnabled') }}</span>
        <div class="flex items-center gap-2">
          <input v-model="disableCode" class="input input-bordered input-sm w-40" :placeholder="t('account.totpCodePlaceholder')" />
          <button class="btn btn-error btn-outline btn-sm" :class="{ 'btn-disabled': totpSaving }" @click="disableTotp">
            <span v-if="totpSaving" class="loading loading-spinner loading-xs"></span>
            {{ t('account.totpDisable') }}
          </button>
        </div>
      </div>
    </PageCard>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import QRCode from 'qrcode'
import { api } from '@/api'
import PageCard from '@/components/PageCard.vue'
import FormField from '@/components/ui/FormField.vue'
import { toastError, toastSuccess, toastWarning } from '@/components/ui/toast'

const { t } = useI18n()
const loading = ref(false)
const saving = ref(false)
const form = reactive({ username: '', current_password: '', new_password: '', confirm_password: '' })

const totpLoading = ref(false)
const totpSaving = ref(false)
const totp = ref<any>({ enabled: false, secret: '', issuer: 'LiteShop' })
const totpCode = ref('')
const disableCode = ref('')
const qrDataUrl = ref('')
const otpauth = computed(() => {
  if (!totp.value.secret) return ''
  return `otpauth://totp/${encodeURIComponent(form.username || 'admin')}?secret=${totp.value.secret}&issuer=${encodeURIComponent(totp.value.issuer || 'LiteShop')}&digits=6&period=30`
})
watch(
  otpauth,
  async (v) => {
    if (!v) {
      qrDataUrl.value = ''
      return
    }
    try {
      qrDataUrl.value = await QRCode.toDataURL(v, { width: 200, margin: 1 })
    } catch {
      qrDataUrl.value = ''
    }
  },
  { immediate: true },
)

onMounted(async () => {
  loading.value = true
  try {
    const data = await api.get<{ username: string }>('/admin/account')
    form.username = data.username
  } finally {
    loading.value = false
  }
  await loadTotp()
})

async function loadTotp() {
  totpLoading.value = true
  try {
    const data = await api.get('/admin/totp')
    totp.value = { ...data, secret: data.enabled ? '' : data.secret }
  } finally {
    totpLoading.value = false
  }
}
async function generateTotp() {
  totpLoading.value = true
  try {
    const data = await api.post('/admin/totp/generate', {})
    totp.value.secret = data.secret
    totp.value.issuer = data.issuer || 'LiteShop'
  } catch (e: any) {
    toastError(e.message)
  } finally {
    totpLoading.value = false
  }
}
async function enableTotp() {
  totpSaving.value = true
  try {
    await api.post('/admin/totp/enable', { secret: totp.value.secret, otp: totpCode.value })
    toastSuccess(t('account.totpDone'))
    await loadTotp()
  } catch (e: any) {
    toastError(e.message)
  } finally {
    totpSaving.value = false
  }
}
async function disableTotp() {
  totpSaving.value = true
  try {
    await api.post('/admin/totp/disable', { otp: disableCode.value })
    toastSuccess(t('account.totpDisabled'))
    await loadTotp()
  } catch (e: any) {
    toastError(e.message)
  } finally {
    totpSaving.value = false
  }
}

async function save() {
  if (!form.username.trim()) {
    toastWarning(t('account.username'))
    return
  }
  if (!form.current_password) {
    toastWarning(t('account.currentPasswordRequired'))
    return
  }
  saving.value = true
  try {
    await api.post('/admin/account', form)
    toastSuccess(t('account.saved'))
    form.current_password = ''
    form.new_password = ''
    form.confirm_password = ''
  } catch (e: any) {
    toastError(e.message)
  } finally {
    saving.value = false
  }
}
</script>
