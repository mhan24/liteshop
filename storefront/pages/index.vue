<template>
  <div>
    <h1 class="text-2xl font-bold mb-1">{{ site?.title || 'LiteShop' }}</h1>
    <p v-if="site?.subtitle" class="text-gray-500 mb-4">{{ site.subtitle }}</p>
    <div v-if="site?.announcement" class="bg-blue-50 border border-blue-100 text-blue-700 rounded p-3 mb-4 md-body">
      <span v-html="renderMarkdown(site.announcement)"></span>
    </div>

    <div class="bg-white rounded-xl border p-3 mb-4">
      <form class="flex flex-wrap gap-2 items-center" @submit.prevent="submit">
        <input
          v-model="filters.q"
          :placeholder="t('searchPlaceholder')"
          class="flex-1 min-w-40 border rounded px-3 py-2 text-sm"
        />
        <select v-model="filters.category" class="border rounded px-3 py-2 text-sm bg-white">
          <option value="all">{{ t('allCategories') }}</option>
          <option v-for="c in allCategories" :key="c" :value="c">{{ c }}</option>
        </select>
        <input
          v-model="filters.min_price"
          type="number"
          step="0.01"
          :placeholder="t('minPrice')"
          class="w-24 border rounded px-3 py-2 text-sm"
        />
        <span class="text-gray-400 text-sm">-</span>
        <input
          v-model="filters.max_price"
          type="number"
          step="0.01"
          :placeholder="t('maxPrice')"
          class="w-24 border rounded px-3 py-2 text-sm"
        />
        <button type="submit" class="bg-brand hover:bg-brand-dark text-white rounded-full px-5 py-2 text-sm font-semibold">
          {{ t('searchBtn') }}
        </button>
        <button
          v-if="isFiltering"
          type="button"
          class="text-sm text-gray-500 hover:text-gray-800 px-2"
          @click="reset"
        >{{ t('resetFilter') }}</button>
      </form>
      <div class="mt-2 flex justify-end">
        <div class="inline-flex border rounded-lg overflow-hidden">
          <button
            type="button"
            :class="viewMode === 'grid' ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-50'"
            class="px-3 py-1.5 text-sm transition"
            @click="setView('grid')"
          >{{ t('viewGrid') }}</button>
          <button
            type="button"
            :class="viewMode === 'list' ? 'bg-brand text-white' : 'bg-white text-gray-600 hover:bg-gray-50'"
            class="px-3 py-1.5 text-sm border-l transition"
            @click="setView('list')"
          >{{ t('viewList') }}</button>
        </div>
      </div>
    </div>

    <div v-for="cat in categories" :key="cat.name || cat.default_key" class="mt-6">
      <h2 class="text-xl font-bold mb-3">{{ catTitle(cat) }}</h2>
      <div v-if="viewMode === 'grid'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div v-for="p in cat.products" :key="p.product.id" class="bg-white rounded-xl border p-4 shadow-sm">
          <NuxtLink :to="productUrl(p.product)" class="block">
            <div class="aspect-square w-full overflow-hidden rounded-lg bg-gray-100 flex items-center justify-center">
              <img
                :src="imgSrc(p.product.image_url)"
                :alt="p.product.name"
                loading="lazy"
                class="max-w-full max-h-full w-auto h-auto"
              />
            </div>
          </NuxtLink>
          <h3 class="font-semibold text-lg mt-2"><NuxtLink :to="productUrl(p.product)" class="hover:text-brand">{{ p.product.name }}</NuxtLink></h3>
          <p class="text-gray-500 text-sm mt-1 line-clamp-2">{{ markdownText(p.product.description) }}</p>
          <p class="text-2xl font-bold mt-3">{{ money(p.product.price_cents) }}</p>
          <p class="text-gray-500 text-sm">{{ t('stock') }} {{ stockLabel(p.available) }}</p>
          <NuxtLink v-if="p.available > 0" :to="productUrl(p.product)" class="inline-block mt-3 bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-2">{{ t('buyNow') }}</NuxtLink>
          <span v-else class="inline-block mt-3 bg-gray-300 text-white rounded-full px-4 py-2">{{ t('soldOut') }}</span>
        </div>
      </div>
      <div v-else class="bg-white rounded-xl border divide-y overflow-hidden shadow-sm">
        <div v-for="p in cat.products" :key="p.product.id" class="flex items-center gap-4 p-3">
          <NuxtLink :to="productUrl(p.product)" class="shrink-0">
            <div class="w-16 h-16 rounded-lg bg-gray-100 overflow-hidden flex items-center justify-center">
              <img
                :src="imgSrc(p.product.image_url)"
                :alt="p.product.name"
                loading="lazy"
                class="max-w-full max-h-full w-auto h-auto"
              />
            </div>
          </NuxtLink>
          <div class="flex-1 min-w-0">
            <h3 class="font-semibold truncate">
              <NuxtLink :to="productUrl(p.product)" class="hover:text-brand">{{ p.product.name }}</NuxtLink>
            </h3>
            <p class="text-gray-500 text-sm truncate mt-0.5">{{ markdownText(p.product.description) }}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xl font-bold">{{ money(p.product.price_cents) }}</p>
            <p class="text-gray-500 text-xs">{{ t('stock') }} {{ stockLabel(p.available) }}</p>
          </div>
          <div class="shrink-0">
            <NuxtLink
              v-if="p.available > 0"
              :to="productUrl(p.product)"
              class="inline-block bg-brand hover:bg-brand-dark text-white rounded-full px-4 py-1.5 text-sm"
            >{{ t('buyNow') }}</NuxtLink>
            <span v-else class="inline-block bg-gray-300 text-white rounded-full px-4 py-1.5 text-sm">{{ t('soldOut') }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="pending" class="text-gray-400">{{ t('loading') }}</div>
    <div v-else-if="!categories.length" class="text-gray-500">{{ t('noProducts') }}</div>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
const { t } = useI18n()
const { money, stockText } = useSiteConfig()
const api = useApi()
const origin = useSiteOrigin()
const siteUrl = computed(() => origin.value + '/')
const { data: site } = await useAsyncData('site', () => api.get('/site'))

const filters = reactive({ q: '', category: 'all', min_price: '', max_price: '' })
const applied = reactive({ q: '', category: 'all', min_price: '', max_price: '' })

const { data, pending, refresh } = await useAsyncData('products', () =>
  api.get('/products', {
    q: applied.q || undefined,
    category: applied.category !== 'all' ? applied.category : undefined,
    min_price: applied.min_price || undefined,
    max_price: applied.max_price || undefined,
  })
)
// 首页视图模式：图片模式（默认）/ 列表模式。
// 用 cookie 让 SSR 与客户端渲染一致（避免 hydration 不一致），localStorage 兼容旧版本选择。
const viewCookie = useCookie<'grid' | 'list'>('liteshop_view_mode', { default: () => 'grid' })
const viewMode = ref<'grid' | 'list'>('grid')
if (import.meta.server) {
  if (viewCookie.value === 'grid' || viewCookie.value === 'list') viewMode.value = viewCookie.value
} else {
  if (viewCookie.value === 'grid' || viewCookie.value === 'list') {
    viewMode.value = viewCookie.value
  } else {
    // 旧版本只存了 localStorage：挂载后再应用，避免 hydration 不一致，并写回 cookie
    const local = localStorage.getItem('liteshop_view_mode')
    if (local === 'grid' || local === 'list') {
      onMounted(() => {
        viewMode.value = local
        viewCookie.value = local
      })
    }
  }
}
function setView(m: 'grid' | 'list') {
  viewMode.value = m
  if (import.meta.client) {
    viewCookie.value = m
    localStorage.setItem('liteshop_view_mode', m)
  }
}

const categories = computed(() => (data.value as any)?.categories || [])
const allCategories = computed(() => (data.value as any)?.categories_all || [])
const isFiltering = computed(() =>
  applied.q || applied.category !== 'all' || applied.min_price || applied.max_price
)

function submit() {
  Object.assign(applied, { q: filters.q.trim(), category: filters.category, min_price: filters.min_price.trim(), max_price: filters.max_price.trim() })
  refresh()
}
function reset() {
  Object.assign(filters, { q: '', category: 'all', min_price: '', max_price: '' })
  Object.assign(applied, { q: '', category: 'all', min_price: '', max_price: '' })
  refresh()
}
function imgSrc(url: string) {
  return url || site.value?.default_product_image || '/default-product.svg'
}
function productUrl(p: any) {
  const id = p.product?.id || p.id
  const slug = p.product?.slug || p.slug
  if (slug && slug !== 'p') return `/product/${encodeURIComponent(slug)}`
  return `/product/${id}`
}
function stockLabel(n: number) {
  const s = stockText(n)
  if (s === 'plenty') return t('stockPlenty')
  if (s === 'tight') return t('stockTight')
  if (s === 'soldout') return t('stockSoldout')
  return s
}
function catTitle(cat: any) {
  return cat.default_key === 'pinned' ? t('pinned') : cat.default_key === 'default_category' ? t('defaultCategory') : cat.name
}
const siteDesc = computed(() => (site.value?.subtitle || site.value?.seo_description || '').slice(0, 160))
const siteImage = computed(() => site.value?.default_product_image || '')

useHead(() => ({
  title: site.value?.title || 'LiteShop',
  titleTemplate: undefined,
  meta: [
    { name: 'description', content: siteDesc.value },
    { property: 'og:type', content: 'website' },
    { property: 'og:title', content: site.value?.title || 'LiteShop' },
    { property: 'og:description', content: siteDesc.value },
    { property: 'og:url', content: siteUrl.value },
    { property: 'og:image', content: siteImage.value },
  ],
  script: [
    {
      type: 'application/ld+json',
      children: JSON.stringify([
        {
          '@context': 'https://schema.org',
          '@type': 'WebSite',
          name: site.value?.title || 'LiteShop',
          url: siteUrl.value,
          description: siteDesc.value,
        },
        {
          '@context': 'https://schema.org',
          '@type': 'Organization',
          name: site.value?.title || 'LiteShop',
          url: siteUrl.value,
          ...(siteImage.value ? { logo: siteImage.value } : {}),
        },
      ]),
    },
  ],
}))
</script>
