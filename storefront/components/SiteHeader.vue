<template>
  <header class="navbar bg-base-100/90 backdrop-blur border-b border-base-300 sticky top-0 z-20 shadow-sm min-h-16">
    <div class="navbar-start">
      <NuxtLink to="/" class="flex items-center gap-2 text-lg font-extrabold text-base-content">
        <img v-if="site?.logo_url" :src="site.logo_url" alt="logo" class="h-8 w-auto" />
        <span v-else>{{ site?.title || 'LiteShop' }}</span>
      </NuxtLink>
    </div>
    <nav class="navbar-center hidden sm:flex gap-1 text-sm font-semibold">
      <NuxtLink to="/" class="btn btn-ghost btn-sm normal-case">{{ t('products') }}</NuxtLink>
      <NuxtLink to="/order" class="btn btn-ghost btn-sm normal-case">{{ t('orderQuery') }}</NuxtLink>
    </nav>
    <div class="navbar-end">
      <div class="join rounded-full border border-base-300 bg-base-100 text-sm">
        <button
          class="join-item px-3 py-1 rounded-full font-semibold transition"
          :class="locale === 'zh' ? 'bg-primary text-primary-content' : 'text-base-content/60 hover:text-primary'"
          @click="setLocale('zh')"
        >中文</button>
        <button
          class="join-item px-3 py-1 rounded-full font-semibold transition"
          :class="locale === 'en' ? 'bg-primary text-primary-content' : 'text-base-content/60 hover:text-primary'"
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
