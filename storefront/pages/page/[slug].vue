<template>
  <div class="max-w-2xl bg-white rounded-xl border p-6 shadow-sm">
    <h1 class="text-xl font-bold mb-2">{{ title }}</h1>
    <div class="md-body text-gray-700" v-html="html"></div>
  </div>
</template>

<script setup lang="ts">
const route = useRoute()
const { t } = useI18n()
const api = useApi()
const origin = useSiteOrigin()
const slug = computed(() => (route.params.slug === 'privacy' ? 'privacy' : 'terms'))
const title = computed(() => (slug.value === 'privacy' ? t('privacy') : t('terms')))
const { data } = await useAsyncData(() => api.get('/pages/' + slug.value))
const content = computed(() => (data.value as any)?.content || '')
const html = computed(() => renderMarkdown(content.value))
useHead({
  title: title.value,
  meta: [{ name: 'description', content: markdownText(content.value).slice(0, 160) }],
  link: [{ rel: 'canonical', href: origin.value + route.path }],
})
</script>
