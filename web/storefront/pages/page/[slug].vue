<template>
  <Card class="w-full max-w-2xl">
    <CardContent>
      <h1 class="mb-2 text-xl font-bold">{{ title }}</h1>
      <div class="md-body text-muted-foreground" v-html="html"></div>
    </CardContent>
  </Card>
</template>

<script setup lang="ts">
import { Card, CardContent } from '@/components/ui/card'
import { usePage } from '@/features/catalog/composables/useCatalog'

const route = useRoute()
const { t } = useI18n()
const origin = useSiteOrigin()
const slug = computed(() => String(route.params.slug))
if (slug.value !== 'privacy' && slug.value !== 'terms') {
  throw createError({ statusCode: 404, statusMessage: 'Page not found' })
}
const title = computed(() => (slug.value === 'privacy' ? t('privacy') : t('terms')))
const { data } = usePage(slug.value)
const content = computed(() => (data.value as any)?.content || '')
const html = computed(() => renderMarkdown(content.value))
useHead({
  title: title.value,
  meta: [{ name: 'description', content: markdownText(content.value).slice(0, 160) }],
  link: [{ rel: 'canonical', href: origin.value + route.path }],
})
</script>
