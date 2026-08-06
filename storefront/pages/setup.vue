<template>
  <div class="min-h-screen flex items-start justify-center py-12 px-4">
    <div class="w-full max-w-lg bg-white rounded-xl border shadow-sm p-6">
      <h1 class="text-xl font-bold mb-2">{{ t('setupTitle') }}</h1>
      <p class="text-gray-500 text-sm mb-4">{{ t('setupIntro') }}</p>
      <div v-if="error" class="bg-red-50 text-red-600 border border-red-100 rounded p-3 mb-3 text-sm">{{ error }}</div>
      <form class="grid gap-3" @submit.prevent="submit">
        <div>
          <label class="text-sm font-semibold">{{ t('siteTitle') }}</label>
          <input v-model="form.site_title" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('adminUsername') }}</label>
          <input v-model="form.username" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('adminPassword') }}</label>
          <input type="password" v-model="form.password" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('confirmPassword') }}</label>
          <input type="password" v-model="form.confirm" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('publicBaseUrl') }}</label>
          <input v-model="form.public_base_url" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('bepusdtBaseUrl') }}</label>
          <input v-model="form.bepusdt_base_url" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('bepusdtToken') }}</label>
          <input v-model="form.bepusdt_api_token" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('tradeTypes') }}</label>
          <input v-model="form.trade_types" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">{{ t('setupToken') }}</label>
          <input v-model="form.setup_token" type="password" class="w-full border rounded px-3 py-2" />
        </div>
        <button type="submit" :disabled="loading" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold disabled:opacity-60">
          {{ loading ? t('processing') : t('completeSetup') }}
        </button>
      </form>
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
  setup_token: '',
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
