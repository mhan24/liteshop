<template>
  <div class="min-h-screen flex flex-col">
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

useHead(() => {
  const st = site.value || {}
  const title = st.title || 'LiteShop'
  const desc = st.seo_description || st.subtitle || ''
  return {
    title: st.title || 'LiteShop',
    titleTemplate: (t?: string) => (t && t !== title ? `${t} - ${title}` : title),
    meta: [
      { name: 'description', content: desc },
      { name: 'keywords', content: st.seo_keywords || '' },
      { property: 'og:type', content: 'website' },
      { property: 'og:title', content: title },
      { property: 'og:description', content: desc },
      { property: 'og:url', content: req.origin + route.path },
    ],
    link: [{ rel: 'canonical', href: req.origin + route.path }],
  }
})
</script>
