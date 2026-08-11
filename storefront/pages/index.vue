<template>
  <div>
    <h1 class="text-3xl font-extrabold text-base-content mb-1">{{ site?.title || 'LiteShop' }}</h1>
    <p v-if="site?.subtitle" class="text-base-content/60 mb-4">{{ site.subtitle }}</p>
    <div v-if="site?.announcement" class="alert alert-info text-sm mb-4 md-body">
      <span v-html="renderMarkdown(site.announcement)"></span>
    </div>

    <div class="card bg-base-100 shadow-sm mb-4">
      <div class="card-body p-3 gap-2">
        <form class="flex flex-wrap gap-2 items-center" @submit.prevent="submit">
        <input
          v-model="filters.q"
          :placeholder="t('searchPlaceholder')"
          class="input input-bordered input-sm flex-1 min-w-40"
        />
        <select v-model="filters.category" class="select select-bordered select-sm bg-base-100">
          <option value="all">{{ t('allCategories') }}</option>
          <option v-for="c in allCategories" :key="c" :value="c">{{ c }}</option>
        </select>
        <input
          v-model="filters.min_price"
          type="number"
          step="0.01"
          :placeholder="t('minPrice')"
          class="input input-bordered input-sm w-24"
        />
        <span class="text-base-content/40 text-sm">-</span>
        <input
          v-model="filters.max_price"
          type="number"
          step="0.01"
          :placeholder="t('maxPrice')"
          class="input input-bordered input-sm w-24"
        />
        <button type="submit" class="btn btn-primary btn-sm">
          {{ t('searchBtn') }}
        </button>
        <button
          v-if="isFiltering"
          type="button"
          class="btn btn-ghost btn-sm text-base-content/60"
          @click="reset"
        >{{ t('resetFilter') }}</button>
        </form>
        <div class="flex justify-end">
        <div class="join">
          <button
            type="button"
            :class="viewMode === 'grid' ? 'btn-active' : ''"
            class="btn btn-sm join-item"
            @click="setView('grid')"
          >{{ t('viewGrid') }}</button>
          <button
            type="button"
            :class="viewMode === 'list' ? 'btn-active' : ''"
            class="btn btn-sm join-item"
            @click="setView('list')"
          >{{ t('viewList') }}</button>
        </div>
      </div>
      </div>
    </div>

    <div v-for="cat in categories" :key="cat.name || cat.default_key" class="mt-6">
      <h2 class="text-xl font-bold text-base-content mb-3">{{ catTitle(cat) }}</h2>
      <div v-if="viewMode === 'grid'" class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <div v-for="p in cat.products" :key="p.product.id" class="card bg-base-100 shadow-sm hover:shadow-md transition-shadow">
          <figure class="aspect-square w-full overflow-hidden bg-base-200 flex items-center justify-center">
            <NuxtLink :to="productUrl(p.product)" class="block w-full h-full flex items-center justify-center">
              <img
                :src="imgSrc(p.product.image_url)"
                :alt="p.product.name"
                loading="lazy"
                class="max-w-full max-h-full w-auto h-auto"
              />
            </NuxtLink>
          </figure>
          <div class="card-body p-4 gap-1">
            <h3 class="font-semibold text-lg leading-snug"><NuxtLink :to="productUrl(p.product)" class="hover:text-primary">{{ p.product.name }}</NuxtLink></h3>
            <p class="text-base-content/60 text-sm line-clamp-2">{{ markdownText(p.product.description) }}</p>
            <p class="text-2xl font-bold text-primary mt-2">{{ money(p.product.price_cents) }}</p>
            <p class="text-base-content/60 text-sm">{{ t('stock') }} {{ stockLabel(p.available) }}</p>
            <div class="card-actions mt-2">
              <NuxtLink v-if="p.available !== 0" :to="productUrl(p.product)" class="btn btn-primary btn-sm normal-case">{{ t('buyNow') }}</NuxtLink>
              <span v-else class="btn btn-disabled btn-sm normal-case">{{ t('soldOut') }}</span>
            </div>
          </div>
        </div>
      </div>
      <div v-else class="card bg-base-100 shadow-sm divide-y divide-base-200">
        <div v-for="p in cat.products" :key="p.product.id" class="flex items-center gap-4 p-4">
          <NuxtLink :to="productUrl(p.product)" class="shrink-0">
            <div class="w-16 h-16 rounded-lg bg-base-200 overflow-hidden flex items-center justify-center">
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
              <NuxtLink :to="productUrl(p.product)" class="hover:text-primary">{{ p.product.name }}</NuxtLink>
            </h3>
            <p class="text-base-content/60 text-sm truncate mt-0.5">{{ markdownText(p.product.description) }}</p>
          </div>
          <div class="text-right shrink-0">
            <p class="text-xl font-bold text-primary">{{ money(p.product.price_cents) }}</p>
            <p class="text-base-content/60 text-xs">{{ t('stock') }} {{ stockLabel(p.available) }}</p>
          </div>
          <div class="shrink-0">
            <NuxtLink
              v-if="p.available !== 0"
              :to="productUrl(p.product)"
              class="btn btn-primary btn-sm normal-case"
            >{{ t('buyNow') }}</NuxtLink>
            <span v-else class="btn btn-disabled btn-sm normal-case">{{ t('soldOut') }}</span>
          </div>
        </div>
      </div>
    </div>
    <div v-if="pending" class="flex justify-center py-10">
      <span class="loading loading-spinner loading-lg text-primary"></span>
    </div>
    <div v-else-if="!categories.length" class="card bg-base-100 shadow-sm">
      <div class="card-body text-center text-base-content/60">{{ t('noProducts') }}</div>
    </div>
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
// 首页视图模式：默认值来自后台站点设置（home_view_mode），用户可手动切换。
// 用户选择写入 cookie（SSR/客户端一致，避免 hydration 不一致）与 localStorage（旧版本兼容）。
const defaultView = computed<'grid' | 'list'>(() => (site.value?.home_view_mode === 'list' ? 'list' : 'grid'))
const viewCookie = useCookie<'grid' | 'list'>('liteshop_view_mode')
const viewMode = ref<'grid' | 'list'>(defaultView.value)
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
  if (n < 0) return t('stockUnlimited')
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
