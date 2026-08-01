<template>
  <header class="bg-white border-b sticky top-0 z-10">
    <div class="max-w-6xl mx-auto px-4 h-16 flex items-center gap-6">
      <NuxtLink to="/" class="text-lg font-extrabold text-gray-900">{{ site?.title || 'LiteShop' }}</NuxtLink>
      <nav class="flex gap-4 text-sm font-semibold text-gray-600">
        <NuxtLink to="/" class="hover:text-brand">商品</NuxtLink>
        <NuxtLink to="/order" class="hover:text-brand">订单查询</NuxtLink>
      </nav>
    </div>
  </header>
</template>

<script setup lang="ts">
defineProps<{ site?: any }>()
</script>
