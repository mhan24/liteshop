<template>
  <div v-if="maintenance" class="min-h-screen flex items-center justify-center px-4">
    <div class="max-w-md w-full text-center py-16">
      <h1 class="text-2xl font-bold text-gray-900">系统维护中</h1>
      <p class="text-gray-600 mt-3">{{ maintenanceMessage || '系统正在维护，请稍后再来。' }}</p>
      <form class="mt-6 flex gap-2" @submit.prevent="unlock">
        <input v-model="unlockPassword" type="password" placeholder="输入解锁密码" class="flex-1 border rounded px-3 py-2" />
        <button type="submit" :disabled="unlocking" class="bg-brand hover:bg-brand-dark text-white rounded px-4 py-2 font-semibold disabled:opacity-60">
          {{ unlocking ? '验证中...' : '解锁' }}
        </button>
      </form>
      <p v-if="unlockError" class="text-red-600 text-sm mt-2">{{ unlockError }}</p>
    </div>
  </div>
  <div v-else class="min-h-screen flex flex-col">
    <SiteHeader :site="site" />
    <main class="flex-1 max-w-6xl w-full mx-auto px-4 py-6">
      <NuxtPage />
    </main>
    <SiteFooter :site="site" />
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const req = useRequestURL()
const site = ref<any>({})
try {
  site.value = await useApi().get('/site')
} catch {}

const maintenance = computed(() => !!site.value?.maintenance?.enabled)
const maintenanceMessage = computed(() => site.value?.maintenance?.message || '')
const hasUnlock = ref(true)
const unlockPassword = ref('')
const unlocking = ref(false)
const unlockError = ref('')

async function unlock() {
  unlocking.value = true
  unlockError.value = ''
  try {
    await useApi().post('/maintenance/unlock', { password: unlockPassword.value })
    await refreshNuxtData()
  } catch (e: any) {
    unlockError.value = e?.data?.error || e?.message || '解锁失败'
  } finally {
    unlocking.value = false
  }
}

useHead(() => {
  const st = site.value || {}
  const title = st.title || 'LiteShop'
  const desc = st.seo_description || st.subtitle || ''
  return {
    title: maintenance.value ? '系统维护中' : (st.title || 'LiteShop'),
    titleTemplate: (t?: string) => (t && t !== title ? `${t} - ${title}` : title),
    meta: [
      { name: 'description', content: maintenance.value ? maintenanceMessage.value : desc },
      { name: 'keywords', content: st.seo_keywords || '' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: desc },
      { property: 'og:url', content: req.origin + route.path },
      ...(maintenance.value ? [{ name: 'robots', content: 'noindex,nofollow' }] : []),
    ],
    link: [{ rel: 'canonical', href: req.origin + route.path }],
  }
})
</script>
