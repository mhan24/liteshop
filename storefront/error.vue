<template>
  <div class="max-w-xl mx-auto mt-20 text-center">
    <h1 class="text-2xl font-bold">{{ error?.statusCode }}</h1>
    <p class="text-gray-600 mt-2">{{ error?.message }}</p>
    <NuxtLink to="/" class="inline-block mt-4 text-primary font-semibold">{{ t('backHome') }}</NuxtLink>
  </div>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'
const { t } = useI18n()
defineProps<{ error: NuxtError }>()
</script>
