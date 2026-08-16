<template>
  <div class="flex items-start justify-center px-4 py-12">
    <Card class="w-full max-w-lg">
      <CardContent>
        <h1 class="mb-2 text-xl font-bold">{{ t('setupTitle') }}</h1>
        <p class="mb-4 text-sm text-muted-foreground">{{ t('setupIntro') }}</p>
        <Alert v-if="error" variant="destructive" class="mb-3">
          <AlertDescription>{{ error }}</AlertDescription>
        </Alert>
        <form class="grid gap-3" @submit.prevent="submit">
          <div>
            <label class="text-sm font-semibold">{{ t('siteTitle') }}</label>
            <Input v-model="form.site_title" class="mt-1" />
          </div>
          <div>
            <label class="text-sm font-semibold">{{ t('adminUsername') }}</label>
            <Input v-model="form.username" class="mt-1" />
          </div>
          <div>
            <label class="text-sm font-semibold">{{ t('adminPassword') }}</label>
            <Input v-model="form.password" type="password" class="mt-1" />
          </div>
          <div>
            <label class="text-sm font-semibold">{{ t('confirmPassword') }}</label>
            <Input v-model="form.confirm" type="password" class="mt-1" />
          </div>
          <div>
            <label class="text-sm font-semibold">{{ t('publicBaseUrl') }}</label>
            <Input v-model="form.public_base_url" class="mt-1" />
          </div>
          <div>
            <label class="text-sm font-semibold">{{ t('bepusdtBaseUrl') }}</label>
            <Input v-model="form.bepusdt_base_url" class="mt-1" />
          </div>
          <div>
            <label class="text-sm font-semibold">{{ t('bepusdtToken') }}</label>
            <Input v-model="form.bepusdt_api_token" class="mt-1" />
          </div>
          <div>
            <label class="text-sm font-semibold">{{ t('tradeTypes') }}</label>
            <Input v-model="form.trade_types" class="mt-1" />
          </div>
          <Button type="submit" :disabled="loading" class="w-fit">
            <Loader2 v-if="loading" class="animate-spin" />
            {{ loading ? t('processing') : t('completeSetup') }}
          </Button>
        </form>
      </CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'

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
