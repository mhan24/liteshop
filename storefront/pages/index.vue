<template>
  <div>
    <div v-if="site?.announcement" class="bg-blue-50 border border-blue-100 text-blue-700 rounded p-3 mb-4">
      {{ site.announcement }}
    </div>
    <div v-for="cat in categories" :key="cat.name || cat.default_key" class="mt-6">
      <h2 class="text-xl font-bold mb-3">{{ catTitle(cat) }}</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div v-for="p in cat.products" :key="p.product.id" class="bg-white rounded-xl border p-4 shadow-sm">
          <h3 class="font-semibold text-lg">{{ p.product.name }}</h3>
          <p class="text-gray-500 text-sm mt-1 whitespace-pre-wrap">{{ p.product.description }}</p>
          <p class="text-2xl font-bold mt-3">¥{{ (p.product.price_cents / 100).toFixed(2) }}</p>
          <p class="text-gray-500 text-sm">{{ t('stock') }} {{ p.available }}</p>
          <NuxtLink v-if="p.available > 0" :to="`/product/${p.product.id}`" class="inline-block mt-3 bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2">{{ t('buyNow') }}</NuxtLink>
          <span v-else class="inline-block mt-3 bg-gray-300 text-white rounded-full px-4 py-2">{{ t('soldOut') }}</span>
        </div>
      </div>
    </div>
    <div v-if="pending" class="text-gray-400">{{ t('loading') }}</div>
    <div v-else-if="!categories.length" class="text-gray-500">{{ t('noProducts') }}</div>
  </div>
</template>

<script setup lang="ts">
const { t } = useI18n()
const api = useApi()
const { data: site } = await useAsyncData('site', () => api.get('/site'))
const { data, pending } = await useAsyncData('products', () => api.get('/products'))
const categories = computed(() => (data.value as any)?.categories || [])
function catTitle(cat: any) {
  return cat.default_key === 'pinned' ? t('pinned') : cat.default_key === 'default_category' ? t('defaultCategory') : cat.name
}
useHead({
  title: () => site.value?.title || 'LiteShop',
  meta: [{ name: 'description', content: () => site.value?.seo_description || site.value?.subtitle || '' }],
})
</script>
