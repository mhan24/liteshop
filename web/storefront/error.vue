<template>
  <div class="mx-auto mt-20 max-w-xl text-center">
    <h1 class="text-2xl font-bold">{{ error?.statusCode }}</h1>
    <p class="mt-2 text-muted-foreground">{{ error?.message }}</p>
    <NuxtLink to="/" class="mt-4 inline-block font-semibold text-primary hover:underline">
      {{ t('backHome') }}
    </NuxtLink>
  </div>
</template>

<script setup lang="ts">
import type { NuxtError } from '#app'
const { t } = useI18n()
defineProps<{ error: NuxtError }>()
</script>
