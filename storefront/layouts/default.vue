<template>
  <div v-if="maintenance" class="min-h-screen flex items-center justify-center px-4">
    <div class="max-w-md w-full text-center py-16">
      <h1 class="text-2xl font-bold text-gray-900">{{ t('maintenance') }}</h1>
      <p class="text-gray-600 mt-3">{{ maintenanceMessage || t('maintenanceMsg') }}</p>
      <form class="mt-6 flex gap-2" @submit.prevent="unlock">
        <input v-model="unlockPassword" type="password" :placeholder="t('unlockPassword')" class="flex-1 border rounded px-3 py-2" />
        <button type="submit" :disabled="unlocking" class="bg-brand hover:bg-brand-dark text-white rounded px-4 py-2 font-semibold disabled:opacity-60">
          {{ unlocking ? t('unlocking') : t('unlock') }}
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

    <div v-if="showAnnouncement" class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div class="bg-white rounded-xl shadow-xl p-6 w-full max-w-md">
        <h2 class="text-lg font-bold">{{ site?.title || 'LiteShop' }}</h2>
        <div class="md-body text-gray-600 mt-2 text-sm" v-html="renderMarkdown(site?.announcement)"></div>
        <div class="mt-4 text-right">
          <button type="button" class="bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2 text-sm" @click="dismissAnnouncement">{{ t('close') }}</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const origin = useSiteOrigin()
const { t } = useI18n()
const site = ref<any>({})
try {
  site.value = await useApi().get('/site')
} catch {}
loadSiteConfig(site.value)

const maintenance = computed(() => !!site.value?.maintenance?.enabled)
const maintenanceMessage = computed(() => site.value?.maintenance?.message || '')

// 公告弹窗：每次访问记忆一次（localStorage）
const showAnnouncement = ref(false)
function dismissAnnouncement() {
  showAnnouncement.value = false
}
onMounted(() => {
  const ann = site.value?.announcement
  if (!ann) return
  const key = 'liteshop_announcement_seen'
  if (localStorage.getItem(key)) return
  showAnnouncement.value = true
  localStorage.setItem(key, '1')
})
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
    unlockError.value = e?.data?.error || e?.message || t('unlockFailed')
  } finally {
    unlocking.value = false
  }
}

useHead(() => {
  const st = site.value || {}
  const title = st.title || 'LiteShop'
  const desc = (st.seo_description || st.subtitle || '').slice(0, 160)
  const ogImage = st.default_product_image || ''
  const mt = t('maintenance')
  return {
    title: maintenance.value ? mt : (st.title || 'LiteShop'),
    titleTemplate: (tt?: string) => (tt && tt !== title ? `${tt} - ${title}` : title),
    htmlAttrs: { lang: st.lang || 'zh-CN' },
    meta: [
      { name: 'description', content: maintenance.value ? maintenanceMessage.value : desc },
      ...(maintenance.value ? [{ name: 'robots', content: 'noindex,nofollow' }] : []),
      { property: 'og:type', content: 'website' },
      { property: 'og:site_name', content: title },
      { property: 'og:title', content: maintenance.value ? mt : title },
      { property: 'og:description', content: desc },
      { property: 'og:url', content: origin.value + route.path },
      { property: 'og:image', content: ogImage },
      { name: 'twitter:card', content: 'summary_large_image' },
      { name: 'twitter:title', content: maintenance.value ? mt : title },
      { name: 'twitter:description', content: desc },
      { name: 'twitter:image', content: ogImage },
    ],
    link: [
      { rel: 'canonical', href: origin.value + route.path },
      ...(st.favicon_url
        ? [{ rel: 'icon', type: faviconType(st.favicon_url), href: st.favicon_url }]
        : []),
    ],
  }
})

function faviconType(url: string) {
  const u = url.toLowerCase()
  if (u.endsWith('.png')) return 'image/png'
  if (u.endsWith('.ico')) return 'image/x-icon'
  if (u.endsWith('.jpg') || u.endsWith('.jpeg')) return 'image/jpeg'
  return 'image/svg+xml'
}
</script>
