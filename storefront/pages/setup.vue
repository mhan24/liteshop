<template>
  <div class="min-h-screen flex items-start justify-center py-12 px-4">
    <div class="w-full max-w-lg card bg-base-100 shadow-sm">
      <div class="card-body">
      <h1 class="text-xl font-bold text-base-content mb-2">{{ t('setupTitle') }}</h1>
      <p class="text-base-content/60 text-sm mb-4">{{ t('setupIntro') }}</p>
      <div v-if="error" class="alert alert-error text-sm mb-3">{{ error }}</div>
      <form class="grid gap-3" @submit.prevent="submit">
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('siteTitle') }}</label>
          <input v-model="form.site_title" class="input input-bordered w-full mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('adminUsername') }}</label>
          <input v-model="form.username" class="input input-bordered w-full mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('adminPassword') }}</label>
          <input type="password" v-model="form.password" class="input input-bordered w-full mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('confirmPassword') }}</label>
          <input type="password" v-model="form.confirm" class="input input-bordered w-full mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('publicBaseUrl') }}</label>
          <input v-model="form.public_base_url" class="input input-bordered w-full mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('bepusdtBaseUrl') }}</label>
          <input v-model="form.bepusdt_base_url" class="input input-bordered w-full mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('bepusdtToken') }}</label>
          <input v-model="form.bepusdt_api_token" class="input input-bordered w-full mt-1" />
        </div>
        <div>
          <label class="text-sm font-semibold text-base-content">{{ t('tradeTypes') }}</label>
          <input v-model="form.trade_types" class="input input-bordered w-full mt-1" />
        </div>
        <button type="submit" :disabled="loading" class="btn btn-primary normal-case disabled:opacity-60">
          {{ loading ? t('processing') : t('completeSetup') }}
        </button>
      </form>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const api = useApi()
const loading = ref(false)
const error = ref('')
const form = reactive({
  site_title: 'LiteShop',
  username: 'admin',
  password: '',
  confirm: '',
  public_base_url: '',
  bepusdt_base_url: '',
  bepusdt_api_token: '',
  trade_types: '',
  fiat: 'CNY',
})

const { data } = await useAsyncData('setup-status', () => api.get('/setup').catch(() => ({ initialized: true })))
if (data.value?.initialized) {
  await navigateTo('/admin/login')
}

async function submit() {
  loading.value = true
  error.value = ''
  try {
    await api.post('/setup', form)
    await navigateTo('/admin/login')
  } catch (e: any) {
    error.value = e?.data?.error || e?.message || t('setupFailed')
  } finally {
    loading.value = false
  }
}
useHead({ title: t('setupTitle'), meta: [{ name: 'robots', content: 'noindex,nofollow' }] })
</script>
