<template>
  <div class="space-y-4">
    <PageCard :title="t('account.title')" :loading="loading">
      <div class="max-w-md space-y-4">
        <FormField :label="t('account.username')" required>
          <Input v-model="form.username" />
        </FormField>
        <FormField :label="t('account.currentPassword')" required>
          <Input v-model="form.current_password" type="password" />
        </FormField>
        <FormField :label="t('account.newPassword')">
          <Input v-model="form.new_password" type="password" />
        </FormField>
        <FormField :label="t('account.confirmPassword')">
          <Input v-model="form.confirm_password" type="password" />
        </FormField>
        <Button :disabled="saving" @click="save">
          <Loader2 v-if="saving" class="animate-spin" />
          {{ t('common.save') }}
        </Button>
      </div>
    </PageCard>

    <PageCard :title="t('account.totp')" :loading="totpLoading">
      <div v-if="!totp.enabled" class="max-w-md space-y-4">
        <p class="text-sm text-muted-foreground">{{ t('account.totpHint') }}</p>
        <Button size="sm" @click="generateTotp">{{ t('account.totpGenerate') }}</Button>

        <div v-if="totp.secret" class="space-y-3 rounded-lg border bg-muted/30 p-4">
          <Alert>
            <Info class="h-4 w-4" />
            <AlertDescription>{{ t('account.totpScanHint') }}</AlertDescription>
          </Alert>
          <img v-if="qrDataUrl" :src="qrDataUrl" alt="TOTP QR" class="h-48 w-48 rounded-lg border bg-white p-1" />
          <p class="text-sm text-muted-foreground">
            {{ t('account.totpSecret') }}: <code class="mono font-semibold">{{ totp.secret }}</code>
          </p>
          <p class="mono text-xs text-muted-foreground">{{ otpauth }}</p>
          <div class="flex items-center gap-2">
            <Input v-model="totpCode" class="w-40" :placeholder="t('account.totpCodePlaceholder')" />
            <Button size="sm" :disabled="totpSaving" @click="enableTotp">
              <Loader2 v-if="totpSaving" class="animate-spin" />
              {{ t('account.totpConfirm') }}
            </Button>
          </div>
        </div>
      </div>

      <div v-else class="max-w-md space-y-4">
        <Badge class="bg-emerald-500/15 text-emerald-700">{{ t('account.totpEnabled') }}</Badge>
        <div class="flex items-center gap-2">
          <Input v-model="disableCode" class="w-40" :placeholder="t('account.totpCodePlaceholder')" />
          <Button variant="destructive" size="sm" :disabled="totpSaving" @click="disableTotp">
            <Loader2 v-if="totpSaving" class="animate-spin" />
            {{ t('account.totpDisable') }}
          </Button>
        </div>
      </div>
    </PageCard>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, computed, watch, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Info, Loader2 } from '@lucide/vue'
import QRCode from 'qrcode'
import { api } from '@/shared/api/client'
import PageCard from '@/shared/components/PageCard.vue'
import { Alert, AlertDescription } from '@/shared/components/ui/alert'
import { Badge } from '@/shared/components/ui/badge'
import { Button } from '@/shared/components/ui/button'
import { Input } from '@/shared/components/ui/input'
import FormField from '@/shared/components/FormField.vue'
import { toastError, toastSuccess, toastWarning } from '@/shared/components/toast'
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
