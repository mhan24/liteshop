<template>
  <div>
    <h1 class="mb-1 text-3xl font-extrabold">{{ site?.title || 'LiteShop' }}</h1>
    <p v-if="site?.subtitle" class="mb-4 text-muted-foreground">{{ site.subtitle }}</p>
    <div v-if="site?.announcement" class="mb-4 rounded-lg border bg-muted/50 p-3 text-sm md-body">
      <span v-html="renderMarkdown(site.announcement)"></span>
    </div>

    <Card class="mb-4">
      <CardContent class="space-y-3">
        <form class="flex flex-wrap items-center gap-2" @submit.prevent="submit">
          <Input v-model="filters.q" :placeholder="t('searchPlaceholder')" class="min-w-40 flex-1" />
          <Select v-model="categoryFilter">
            <SelectTrigger class="w-36">
              <SelectValue :placeholder="t('allCategories')" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{{ t('allCategories') }}</SelectItem>
              <SelectItem v-for="c in allCategories" :key="c" :value="c">{{ c }}</SelectItem>
            </SelectContent>
          </Select>
          <Input v-model="filters.min_price" type="number" step="0.01" :placeholder="t('minPrice')" class="w-24" />
          <span class="text-sm text-muted-foreground">-</span>
          <Input v-model="filters.max_price" type="number" step="0.01" :placeholder="t('maxPrice')" class="w-24" />
          <Button size="sm" type="submit">{{ t('searchBtn') }}</Button>
          <Button v-if="isFiltering" variant="ghost" size="sm" class="text-muted-foreground" @click="reset">
            {{ t('resetFilter') }}
          </Button>
        </form>
        <div class="flex justify-end">
          <div class="flex items-center gap-1">
            <Button :variant="viewMode === 'grid' ? 'secondary' : 'ghost'" size="sm" @click="setView('grid')">
              {{ t('viewGrid') }}
            </Button>
            <Button :variant="viewMode === 'list' ? 'secondary' : 'ghost'" size="sm" @click="setView('list')">
              {{ t('viewList') }}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>

    <div v-for="cat in categories" :key="cat.name || cat.default_key" class="mt-6">
      <h2 class="mb-3 text-xl font-bold">{{ catTitle(cat) }}</h2>
      <div v-if="viewMode === 'grid'" class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Card v-for="p in cat.products" :key="p.product.id" class="transition hover:shadow-md">
          <div class="flex aspect-square w-full items-center justify-center overflow-hidden bg-muted">
            <NuxtLink :to="productUrl(p.product)" class="flex h-full w-full items-center justify-center">
              <img
                :src="imgSrc(p.product.image_url)"
                :alt="p.product.name"
                loading="lazy"
                class="h-auto max-h-full w-auto max-w-full"
              />
            </NuxtLink>
          </div>
          <CardContent class="space-y-1">
            <h3 class="text-lg font-semibold leading-snug">
              <NuxtLink :to="productUrl(p.product)" class="hover:text-primary">{{ p.product.name }}</NuxtLink>
            </h3>
            <p class="line-clamp-2 text-sm text-muted-foreground">{{ markdownText(p.product.description) }}</p>
            <p class="mt-2 text-2xl font-bold text-primary">{{ money(p.product.price_cents) }}</p>
            <p class="text-sm text-muted-foreground">{{ t('stock') }} {{ stockLabel(p.available) }}</p>
            <div class="pt-2">
              <Button as-child v-if="p.available !== 0" size="sm">
                <NuxtLink :to="productUrl(p.product)">{{ t('buyNow') }}</NuxtLink>
              </Button>
              <Button v-else variant="secondary" size="sm" disabled>{{ t('soldOut') }}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
      <Card v-else>
        <CardContent class="divide-y p-0">
          <div v-for="p in cat.products" :key="p.product.id" class="flex items-center gap-4 p-4">
            <NuxtLink :to="productUrl(p.product)" class="shrink-0">
              <div class="flex h-16 w-16 items-center justify-center overflow-hidden rounded-lg bg-muted">
                <img
                  :src="imgSrc(p.product.image_url)"
                  :alt="p.product.name"
                  loading="lazy"
                  class="h-auto max-h-full w-auto max-w-full"
                />
              </div>
            </NuxtLink>
            <div class="min-w-0 flex-1">
              <h3 class="truncate font-semibold">
                <NuxtLink :to="productUrl(p.product)" class="hover:text-primary">{{ p.product.name }}</NuxtLink>
              </h3>
              <p class="mt-0.5 truncate text-sm text-muted-foreground">{{ markdownText(p.product.description) }}</p>
            </div>
            <div class="shrink-0 text-right">
              <p class="text-xl font-bold text-primary">{{ money(p.product.price_cents) }}</p>
              <p class="text-xs text-muted-foreground">{{ t('stock') }} {{ stockLabel(p.available) }}</p>
            </div>
            <div class="shrink-0">
              <Button as-child v-if="p.available !== 0" size="sm">
                <NuxtLink :to="productUrl(p.product)">{{ t('buyNow') }}</NuxtLink>
              </Button>
              <Button v-else variant="secondary" size="sm" disabled>{{ t('soldOut') }}</Button>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
    <div v-if="pending" class="flex justify-center py-10">
      <Loader2 class="h-8 w-8 animate-spin text-muted-foreground" />
    </div>
    <Card v-else-if="!categories.length">
      <CardContent class="py-8 text-center text-muted-foreground">{{ t('noProducts') }}</CardContent>
    </Card>
  </div>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import { Loader2 } from '@lucide/vue'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { useProducts, useSite } from '@/features/catalog/composables/useCatalog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'

const { t } = useI18n()
const { money, stockText } = useSiteConfig()
const origin = useSiteOrigin()
const siteUrl = computed(() => origin.value + '/')
const { data: site } = useSite()

const filters = reactive({ q: '', category: 'all', min_price: '', max_price: '' })
const applied = reactive({ q: '', category: 'all', min_price: '', max_price: '' })
const categoryFilter = ref('all')

const { data, pending, refresh } = useProducts(() => ({
  q: applied.q || undefined,
  category: applied.category !== 'all' ? applied.category : undefined,
  min_price: applied.min_price || undefined,
  max_price: applied.max_price || undefined,
}))
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
const isFiltering = computed(() => applied.q || applied.category !== 'all' || applied.min_price || applied.max_price)

function submit() {
  filters.category = categoryFilter.value
  Object.assign(applied, {
    q: filters.q.trim(),
    category: categoryFilter.value,
    min_price: filters.min_price.trim(),
    max_price: filters.max_price.trim(),
  })
  refresh()
}
function reset() {
  categoryFilter.value = 'all'
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
  return cat.default_key === 'pinned'
    ? t('pinned')
    : cat.default_key === 'default_category'
      ? t('defaultCategory')
      : cat.name
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
