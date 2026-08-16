<template>
  <div class="flex min-h-screen items-center justify-center bg-muted/30 p-4">
    <Card class="w-full max-w-sm">
      <CardHeader class="items-center text-center">
        <div class="mb-2 flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <Store class="h-6 w-6" />
        </div>
        <CardTitle class="text-xl">{{ t('login.title') }}</CardTitle>
        <p class="text-sm text-muted-foreground">LiteShop</p>
      </CardHeader>
      <CardContent class="space-y-4">
        <FormField :label="t('login.username')" required>
          <Input v-model="form.username" autocomplete="username" @keyup.enter="submit" />
        </FormField>
        <FormField :label="t('login.password')" required>
          <Input v-model="form.password" type="password" autocomplete="current-password" @keyup.enter="submit" />
        </FormField>
        <FormField v-if="totpStep" :label="t('login.otp')" required>
          <Input
            v-model="form.otp"
            inputmode="numeric"
            maxlength="6"
            class="text-center text-lg tracking-[0.5em]"
            autocomplete="one-time-code"
            @keyup.enter="submit"
          />
        </FormField>
        <Button class="w-full" :disabled="loading" @click="submit">
          <Loader2 v-if="loading" class="animate-spin" />
          {{ t(totpStep ? 'login.verify' : 'login.login') }}
        </Button>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { Loader2, Store } from '@lucide/vue'
import { api } from '@/shared/api/client'
import { Button } from '@/shared/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/shared/components/ui/card'
import { Input } from '@/shared/components/ui/input'
import FormField from '@/shared/components/FormField.vue'
import { toastError, toastWarning } from '@/shared/components/toast'

const { t } = useI18n()
const loading = ref(false)
const totpStep = ref(false)
const totpToken = ref('')
const form = reactive({ username: '', password: '', otp: '' })

onMounted(async () => {
  try {
    const data = await api.get<{ initialized?: boolean }>('/setup')
    if (!data.initialized) window.location.href = '/setup'
  } catch {
    // ignore
  }
})

async function submit() {
  if (!form.username.trim()) {
    toastWarning(t('login.usernameRequired'))
    return
  }
  if (!form.password) {
    toastWarning(t('login.passwordRequired'))
    return
  }
  if (totpStep.value && !form.otp.trim()) {
    toastWarning(t('login.otpRequired'))
    return
  }
  loading.value = true
  try {
    if (!totpStep.value) {
      const res = await api.post('/admin/login', { username: form.username, password: form.password })
      if (res.totp_required) {
        totpStep.value = true
        totpToken.value = res.token
        return
      }
      window.location.href = '/admin/'
    } else {
      await api.post('/admin/login/verify', { token: totpToken.value, otp: form.otp })
      window.location.href = '/admin/'
    }
  } catch (e: any) {
    toastError(e.message)
  } finally {
    loading.value = false
  }
}
</script>
