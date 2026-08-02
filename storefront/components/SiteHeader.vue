<template>
  <header class="bg-white border-b sticky top-0 z-10">
    <div class="max-w-6xl mx-auto px-4 h-16 flex items-center gap-6">
      <NuxtLink to="/" class="text-lg font-extrabold text-gray-900">{{ site?.title || 'LiteShop' }}</NuxtLink>
      <nav class="flex gap-4 text-sm font-semibold text-gray-600">
        <NuxtLink to="/" class="hover:text-brand">{{ t('products') }}</NuxtLink>
        <NuxtLink to="/order" class="hover:text-brand">{{ t('orderQuery') }}</NuxtLink>
      </nav>
      <div style="flex:1"></div>
      <div class="flex items-center border rounded-full p-0.5 text-sm">
        <button
          class="px-3 py-1 rounded-full font-semibold transition"
          :class="locale === 'zh' ? 'bg-brand text-white' : 'text-gray-600 hover:text-brand'"
          @click="setLocale('zh')"
        >中文</button>
        <button
          class="px-3 py-1 rounded-full font-semibold transition"
          :class="locale === 'en' ? 'bg-brand text-white' : 'text-gray-600 hover:text-brand'"
          @click="setLocale('en')"
        >EN</button>
      </div>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ site?: any }>()
const { t, locale, setLocale } = useI18n()
</script>
