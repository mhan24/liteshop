<template>
  <div v-if="maintenance" class="flex min-h-screen items-center justify-center px-4">
    <Card class="w-full max-w-md">
      <CardContent class="space-y-4 py-8 text-center">
        <h1 class="text-2xl font-bold">{{ t('maintenance') }}</h1>
        <p class="text-muted-foreground">{{ maintenanceMessage || t('maintenanceMsg') }}</p>
        <form class="flex gap-2 text-left" @submit.prevent="unlock">
          <Input v-model="unlockPassword" type="password" :placeholder="t('unlockPassword')" class="flex-1" />
          <Button type="submit" :disabled="unlocking">
            <Loader2 v-if="unlocking" class="animate-spin" />
            {{ unlocking ? t('unlocking') : t('unlock') }}
          </Button>
        </form>
        <p v-if="unlockError" class="text-sm text-destructive">{{ unlockError }}</p>
      </CardContent>
    </Card>
  </div>
  <div v-else class="flex min-h-screen flex-col">
    <SiteHeader :site="site" />
    <main class="mx-auto w-full max-w-6xl flex-1 px-4 py-6">
      <NuxtPage />
    </main>
    <SiteFooter :site="site" />

    <Dialog :open="showAnnouncement" @update:open="showAnnouncement = $event">
      <DialogContent class="max-w-md">
        <DialogHeader>
          <DialogTitle>{{ site?.title || 'LiteShop' }}</DialogTitle>
        </DialogHeader>
        <div class="md-body text-sm text-muted-foreground" v-html="renderMarkdown(site?.announcement)"></div>
        <DialogFooter>
          <Button size="sm" @click="dismissAnnouncement">{{ t('close') }}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </div>
</template>

<script setup lang="ts">
import { Loader2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import SiteFooter from '@/components/SiteFooter.vue'
import SiteHeader from '@/components/SiteHeader.vue'

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
        ? [{ rel: 'icon', key: 'icon', type: faviconType(st.favicon_url), href: st.favicon_url }]
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
