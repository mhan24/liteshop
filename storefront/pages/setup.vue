<template>
  <div class="min-h-screen flex items-start justify-center py-12 px-4">
    <div class="w-full max-w-lg bg-white rounded-xl border shadow-sm p-6">
      <h1 class="text-xl font-bold mb-2">初始化设置</h1>
      <p class="text-gray-500 text-sm mb-4">配置管理员账号和基础信息，完成后可登录后台修改所有配置。</p>
      <div v-if="error" class="bg-red-50 text-red-600 border border-red-100 rounded p-3 mb-3 text-sm">{{ error }}</div>
      <form class="grid gap-3" @submit.prevent="submit">
        <div>
          <label class="text-sm font-semibold">站点标题</label>
          <input v-model="form.site_title" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">管理员用户名</label>
          <input v-model="form.username" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">管理员密码（至少 8 位）</label>
          <input type="password" v-model="form.password" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">确认密码</label>
          <input type="password" v-model="form.confirm" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">前台公开地址</label>
          <input v-model="form.public_base_url" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">BEpusdt Base URL</label>
          <input v-model="form.bepusdt_base_url" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">BEpusdt API Token</label>
          <input v-model="form.bepusdt_api_token" class="w-full border rounded px-3 py-2" />
        </div>
        <div>
          <label class="text-sm font-semibold">收款类型（逗号分隔）</label>
          <input v-model="form.trade_types" class="w-full border rounded px-3 py-2" />
        </div>
        <button type="submit" :disabled="loading" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 font-semibold disabled:opacity-60">
          {{ loading ? '处理中...' : '完成初始化' }}
        </button>
      </form>
    </div>
  </div>
</template>

<script setup lang="ts">
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
    error.value = e?.data?.error || e?.message || '初始化失败'
  } finally {
    loading.value = false
  }
}
useHead({ title: '初始化设置' })
</script>
