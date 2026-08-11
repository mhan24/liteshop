<template>
  <header class="sticky top-0 z-20 flex h-16 items-center gap-4 border-b bg-background/95 px-4 backdrop-blur">
    <NuxtLink to="/" class="flex items-center gap-2 text-lg font-extrabold">
      <img v-if="site?.logo_url" :src="site.logo_url" alt="logo" class="h-8 w-auto" />
      <span v-else>{{ site?.title || 'LiteShop' }}</span>
    </NuxtLink>
    <nav class="hidden flex-1 items-center gap-1 sm:flex">
      <Button as-child variant="ghost" size="sm">
        <NuxtLink to="/">{{ t('products') }}</NuxtLink>
      </Button>
      <Button as-child variant="ghost" size="sm">
        <NuxtLink to="/order">{{ t('orderQuery') }}</NuxtLink>
      </Button>
    </nav>
    <div class="flex-1 sm:hidden"></div>
    <div class="flex items-center gap-1">
      <Button :variant="locale === 'zh' ? 'secondary' : 'ghost'" size="sm" @click="setLocale('zh')">
        中文
      </Button>
      <Button :variant="locale === 'en' ? 'secondary' : 'ghost'" size="sm" @click="setLocale('en')">
        EN
      </Button>
    </div>
  </header>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button'

defineProps<{ site?: any }>()
const { t, locale, setLocale } = useI18n()
</script>
