<template>
  <div class="flex min-h-screen items-center justify-center bg-base-200 p-4">
    <div class="card w-full max-w-sm bg-base-100 shadow-xl">
      <div class="card-body">
        <div class="mb-4 flex items-center gap-3">
          <div
            class="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-content"
          >
            <svg
              class="h-6 w-6"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              stroke-width="2"
              stroke-linecap="round"
              stroke-linejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </div>
          <div>
            <h1 class="card-title">{{ t('login.title') }}</h1>
            <p class="text-sm opacity-60">LiteShop</p>
          </div>
        </div>

        <FormField :label="t('login.username')" required>
          <input
            v-model="form.username"
            class="input input-bordered w-full"
            autocomplete="username"
            @keyup.enter="submit"
          />
        </FormField>
        <FormField :label="t('login.password')" required>
          <input
            v-model="form.password"
            type="password"
            class="input input-bordered w-full"
            autocomplete="current-password"
            @keyup.enter="submit"
          />
        </FormField>
        <FormField v-if="totpStep" :label="t('login.otp')" required>
          <input
            v-model="form.otp"
            inputmode="numeric"
            maxlength="6"
            class="input input-bordered w-full text-center text-lg tracking-[0.5em]"
            autocomplete="one-time-code"
            @keyup.enter="submit"
          />
        </FormField>

        <button class="btn btn-primary mt-3 w-full" :class="{ 'btn-disabled': loading }" @click="submit">
          <span v-if="loading" class="loading loading-spinner"></span>
          {{ t(totpStep ? 'login.verify' : 'login.login') }}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { reactive, ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '@/api'
import FormField from '@/components/ui/FormField.vue'
import { toastError, toastWarning } from '@/components/ui/toast'

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
